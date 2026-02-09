import Combine
import Foundation
import UIKit

@MainActor
final class HostSessionManager: ObservableObject {
    private let urlSession: URLSession
    private var timer: Timer?

    // Keep state on the main actor for SwiftUI observers.
    @Published private var scriptRunning: Bool = false
    @Published private var activeScriptName: String = ""

    // Hold weak refs so Timer closures don't capture non-Sendable values.
    private weak var authRef: AuthenticationManager?
    private weak var deviceRef: USBManager?

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

    func start(auth: AuthenticationManager, device: USBManager) {
        stop()

        self.authRef = auth
        self.deviceRef = device

        Task { await self.sendHeartbeatTick() }
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { await self.sendHeartbeatTick() }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func backendConfig(auth: AuthenticationManager) -> (baseURL: URL, accessToken: String)? {
        guard let base = CloudConfig.backendBaseURL() else { return nil }

        let allowAnon = CloudConfig.allowAnonSync()
        if let session = auth.session, !session.idToken.isEmpty {
            return (baseURL: base, accessToken: session.idToken)
        }
        if allowAnon {
            return (baseURL: base, accessToken: "")
        }
        return nil
    }

    private func sendHeartbeatTick() async {
        guard let auth = authRef, let device = deviceRef else { return }
        guard let cfg = backendConfig(auth: auth) else { return }

        var url = cfg.baseURL
        url.appendPathComponent("v1/hosts/heartbeat")

        let payload: [String: Any] = [
            "host_session_id": hostSessionId,
            "platform": "ios",
            "device_name": UIDevice.current.name,
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

            _ = try await urlSession.data(for: req)
        } catch {
            // Best-effort.
        }
    }
}
