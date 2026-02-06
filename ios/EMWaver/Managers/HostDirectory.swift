import Combine
import Foundation

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

    // Convenience
    var usbConnected: Bool { status["usb_connected"]?.boolValue ?? false }
    var connectedPort: String { status["connected_port"]?.stringValue ?? "" }
    var scriptRunning: Bool { status["script_running"]?.boolValue ?? false }
    var activeScriptName: String { status["active_script_name"]?.stringValue ?? "" }
}

struct HostSessionsResponse: Codable {
    let hosts: [HostSession]
    let now_ms: Int64
}

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
}

@MainActor
final class HostDirectory: ObservableObject {
    @Published private(set) var hosts: [HostSession] = []
    @Published private(set) var lastErrorText: String = ""
    @Published private(set) var lastUpdatedAt: Date? = nil

    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func refresh(auth: AuthenticationManager) async {
        guard let base = CloudConfig.backendBaseURL() else {
            hosts = []
            lastErrorText = "Backend URL not configured"
            return
        }

        let allowAnon = CloudConfig.allowAnonSync()
        let tok = auth.session?.idToken ?? ""
        if tok.isEmpty && !allowAnon {
            hosts = []
            lastErrorText = "Please sign in to view hosts."
            return
        }

        var url = base
        url.appendPathComponent("v1/hosts")

        do {
            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            if !tok.isEmpty {
                req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
            }

            let (data, res) = try await urlSession.data(for: req)
            if let http = res as? HTTPURLResponse, http.statusCode >= 400 {
                let text = String(data: data, encoding: .utf8) ?? ""
                lastErrorText = text.isEmpty ? "HTTP \(http.statusCode)" : text
                hosts = []
                return
            }

            let decoded = try JSONDecoder().decode(HostSessionsResponse.self, from: data)
            hosts = decoded.hosts
            lastErrorText = ""
            lastUpdatedAt = Date()
        } catch {
            lastErrorText = error.localizedDescription
            hosts = []
        }
    }
}
