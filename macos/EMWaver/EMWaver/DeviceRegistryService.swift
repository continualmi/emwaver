import Combine
import Foundation

/// When a genuine device connects (DeviceID+Proof verified locally), inform backend so it can be attached
/// to the signed-in account (or prompt for login if user is anonymous).
@MainActor
final class DeviceRegistryService: ObservableObject {
    private var cancellables: Set<AnyCancellable> = []
    private var lastSeenKey: String = ""

    func start(auth: AuthenticationManager, device: MacUSBManager) {
        // Re-check whenever auth or secure device identity changes.
        Publishers.CombineLatest(auth.$session, device.$secureDeviceIdB64)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] session, deviceIdB64 in
                guard let self else { return }
                Task { await self.sync(auth: auth, device: device, session: session, deviceIdB64: deviceIdB64) }
            }
            .store(in: &cancellables)
    }

    private func sync(auth: AuthenticationManager, device: MacUSBManager, session: AuthSession?, deviceIdB64: String?) async {
        guard device.isConnected, device.isSecureConnected else { return }
        guard let deviceIdB64, !deviceIdB64.isEmpty else { return }
        guard let proofB64 = device.secureDeviceProofB64, !proofB64.isEmpty else { return }
        guard let baseURL = BackendUrl.resolve() else {
            device.deviceAttachStatusText = "Missing backend URL"
            return
        }

        let token = (session?.idToken ?? "")
        let key = "\(deviceIdB64):\(token.isEmpty ? "anon" : "auth")"
        if key == lastSeenKey { return }
        lastSeenKey = key

        device.deviceAttachStatusText = "Checking device…"

        var req = URLRequest(url: baseURL.appendingPathComponent("/v1/devices/seen"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = ["device_id_b64": deviceIdB64, "proof_b64": proofB64]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                device.deviceAttachStatusText = "Device check failed"
                return
            }

            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

            if http.statusCode != 200 {
                let raw = String(data: data, encoding: .utf8) ?? ""
                device.deviceAttachStatusText = raw.isEmpty ? "Device check failed (HTTP \(http.statusCode))" : raw
                return
            }

            let needsLogin = (obj?["needs_login"] as? Bool) ?? false
            let attached = (obj?["attached"] as? Bool) ?? false
            let claimed = (obj?["claimed"] as? Bool) ?? false

            if needsLogin && token.isEmpty {
                device.needsLoginToSaveDevice = true
                device.deviceAttachStatusText = "Sign in to save device"
                return
            }

            device.needsLoginToSaveDevice = false
            if attached {
                device.deviceAttachStatusText = "Device saved to account"
            } else if claimed {
                device.deviceAttachStatusText = "Device verified"
            } else {
                device.deviceAttachStatusText = "Device verified"
            }
        } catch {
            device.deviceAttachStatusText = error.localizedDescription
        }
    }
}
