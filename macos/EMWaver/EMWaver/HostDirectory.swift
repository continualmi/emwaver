import Foundation
import Combine

// Mirrors backend/emw_backend/routes/hosts.py response schema.
struct HostSession: Identifiable, Codable, Hashable {
    let id: String
    let platform: String
    let device_name: String
    let app_version: String
    let capabilities: [String: JSONValue]
    let status: [String: JSONValue]
    let created_at_ms: Int64
    let last_seen_at_ms: Int64
    let online: Bool

    // Convenience accessors (best-effort parsing)
    var usbConnected: Bool {
        status["usb_connected"]?.boolValue ?? false
    }

    var connectedPort: String {
        status["connected_port"]?.stringValue ?? ""
    }

    var scriptRunning: Bool {
        status["script_running"]?.boolValue ?? false
    }

    var activeScriptName: String {
        status["active_script_name"]?.stringValue ?? ""
    }

    var supportsUSB: Bool {
        capabilities["usb"]?.boolValue ?? false
    }

    var supportsScripts: Bool {
        capabilities["scripts"]?.boolValue ?? false
    }
}

struct HostSessionsResponse: Codable {
    let hosts: [HostSession]
    let now_ms: Int64
}

/// Minimal JSON value wrapper so we can decode capabilities/status without locking down a schema.
/// This keeps the host heartbeat payload forward-compatible.
enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON value")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    var numberValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }
}

@MainActor
final class HostDirectory: ObservableObject {
    @Published private(set) var hosts: [HostSession] = []
    @Published private(set) var lastErrorText: String = ""
    @Published private(set) var lastUpdatedAt: Date? = nil

    private let urlSession: URLSession
    private var timer: Timer?

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func start(auth: AuthenticationManager) {
        stop()
        Task { await self.refresh(auth: auth) }
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.refresh(auth: auth) }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func backendConfig(auth: AuthenticationManager) -> (baseURL: URL, accessToken: String)? {
        guard let base = BackendUrl.resolve() else { return nil }

        let allowAnonSync = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")

        if let session = auth.session, !session.idToken.isEmpty {
            return (baseURL: base, accessToken: session.idToken)
        }
        if allowAnonSync {
            return (baseURL: base, accessToken: "")
        }
        return nil
    }

    func refresh(auth: AuthenticationManager) async {
        guard let cfg = backendConfig(auth: auth) else {
            // Not signed in / no backend configured.
            hosts = []
            lastErrorText = ""
            return
        }

        var url = cfg.baseURL
        url.appendPathComponent("v1/hosts")

        do {
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            if !cfg.accessToken.isEmpty {
                req.setValue("Bearer \(cfg.accessToken)", forHTTPHeaderField: "Authorization")
            }

            let (data, res) = try await urlSession.data(for: req)
            let http = res as? HTTPURLResponse
            if let http, http.statusCode >= 400 {
                let text = String(data: data, encoding: .utf8) ?? ""
                throw NSError(domain: "HostDirectory", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "HTTP \(http.statusCode)" : text])
            }

            let decoded = try JSONDecoder().decode(HostSessionsResponse.self, from: data)
            self.hosts = decoded.hosts
            self.lastErrorText = ""
            self.lastUpdatedAt = Date()
        } catch {
            self.lastErrorText = error.localizedDescription
        }
    }
}
