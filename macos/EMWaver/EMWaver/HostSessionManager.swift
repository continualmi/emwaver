import Combine
import Foundation

@MainActor
final class HostSessionManager: ObservableObject {
    // ObservableObject conformance (we don't currently publish UI state, but SwiftUI's @StateObject requires it).
    let objectWillChange = ObservableObjectPublisher()
    private let urlSession: URLSession
    private var timer: Timer?

    private var scriptRunning: Bool = false
    private var activeScriptName: String = ""

    private let hostSessionIdKey = "emwaver.hostSessionId"

    private(set) var hostSessionId: String

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession

        if let existing = UserDefaults.standard.string(forKey: hostSessionIdKey), !existing.isEmpty {
            hostSessionId = existing
        } else {
            let newId = UUID().uuidString
            hostSessionId = newId
            UserDefaults.standard.set(newId, forKey: hostSessionIdKey)
        }
    }

    func setScriptStatus(running: Bool, activeScriptName: String?) {
        self.scriptRunning = running
        self.activeScriptName = (activeScriptName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func start(auth: AuthenticationManager, device: MacUSBManager) {
        stop()
        // Kick immediately and then every 10s.
        Task { await self.sendHeartbeat(auth: auth, device: device) }
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.sendHeartbeat(auth: auth, device: device) }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func backendConfig(auth: AuthenticationManager) -> (baseURL: URL, accessToken: String)? {
        // Same resolution order as ContentView cloud config.
        guard let base = BackendUrl.resolve() else { return nil }

        let allowAnonSync = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")

        if !auth.accessToken.isEmpty {
            return (baseURL: base, accessToken: auth.accessToken)
        }
        if allowAnonSync {
            return (baseURL: base, accessToken: "")
        }
        return nil
    }

    private func sendHeartbeat(auth: AuthenticationManager, device: MacUSBManager) async {
        guard let cfg = backendConfig(auth: auth) else { return }

        var url = cfg.baseURL
        url.appendPathComponent("v1/hosts/heartbeat")

        let payload: [String: Any] = [
            "host_session_id": hostSessionId,
            "platform": "macos",
            "device_name": Host.current().localizedName ?? "Mac",
            "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "capabilities": [
                "usb": true,
                "scripts": true
            ],
            "status": [
                "usb_connected": device.isConnected,
                "connected_port": device.connectedPortName ?? "",
                "script_running": scriptRunning,
                "active_script_name": activeScriptName
            ]
        ]

        do {
            let body = try JSONSerialization.data(withJSONObject: payload)
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            if !cfg.accessToken.isEmpty {
                req.setValue("Bearer \(cfg.accessToken)", forHTTPHeaderField: "Authorization")
            }
            req.httpBody = body

            let (_, res) = try await urlSession.data(for: req)
            if (res as? HTTPURLResponse)?.statusCode == 401 {
                auth.handleUnauthorizedResponse()
            }
        } catch {
            // Best-effort: presence should not impact UX.
        }
    }
}
