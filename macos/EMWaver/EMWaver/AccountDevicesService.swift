import Combine
import Foundation
import Network

@MainActor
final class AccountDevicesService: ObservableObject {
    struct DeviceRecord: Codable, Identifiable {
        var id: String { deviceIdB64 }
        let deviceIdB64: String
        let label: String
        let boardType: String?
        let hardwareUid: String?
        let createdAtMs: Int64
        let updatedAtMs: Int64
        let lastSeenAtMs: Int64

        enum CodingKeys: String, CodingKey {
            case deviceIdB64 = "device_id_b64"
            case label
            case boardType = "board_type"
            case hardwareUid = "hardware_uid"
            case createdAtMs = "created_at_ms"
            case updatedAtMs = "updated_at_ms"
            case lastSeenAtMs = "last_seen_at_ms"
        }
    }

    private struct DevicesResponse: Decodable {
        let devices: [DeviceRecord]
    }

    private let cacheKey = "emwaver.accountDevices.cache"
    private let pathMonitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "com.emwaver.macos.accountDevices.path")
    private var cancellables: Set<AnyCancellable> = []
    private var refreshTask: Task<Void, Never>?

    @Published private(set) var devices: [DeviceRecord] = []
    @Published private(set) var isOfflineMode: Bool = false
    @Published private(set) var lastSyncAt: Date? = nil
    @Published private(set) var lastError: String? = nil

    func start(auth: AuthenticationManager) {
        loadCache()

        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let offline = path.status != .satisfied
                let changed = offline != self.isOfflineMode
                self.isOfflineMode = offline
                if changed {
                    if offline {
                        self.loadCache()
                    } else {
                        self.refresh(auth: auth)
                    }
                }
            }
        }
        pathMonitor.start(queue: monitorQueue)

        auth.$session
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refresh(auth: auth)
            }
            .store(in: &cancellables)

        refresh(auth: auth)
    }

    deinit {
        pathMonitor.cancel()
        refreshTask?.cancel()
    }

    func refresh(auth: AuthenticationManager) {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            await self?.performRefresh(auth: auth)
        }
    }

    func hasOfflineAccess(boardType: String, hardwareUid: String) -> Bool {
        devices.contains { device in
            device.boardType?.caseInsensitiveCompare(boardType) == .orderedSame &&
            normalized(device.hardwareUid) == normalized(hardwareUid)
        }
    }

    func storeClaimedDevice(deviceIdB64: String, boardType: String, hardwareUid: String) {
        let normalizedUid = normalized(hardwareUid)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

        if let index = devices.firstIndex(where: {
            $0.boardType?.caseInsensitiveCompare(boardType) == .orderedSame &&
            normalized($0.hardwareUid) == normalizedUid
        }) {
            let existing = devices[index]
            devices[index] = DeviceRecord(
                deviceIdB64: deviceIdB64,
                label: existing.label.isEmpty ? "EMWaver device" : existing.label,
                boardType: boardType,
                hardwareUid: hardwareUid,
                createdAtMs: existing.createdAtMs,
                updatedAtMs: nowMs,
                lastSeenAtMs: nowMs
            )
        } else {
            devices.insert(
                DeviceRecord(
                    deviceIdB64: deviceIdB64,
                    label: "EMWaver device",
                    boardType: boardType,
                    hardwareUid: hardwareUid,
                    createdAtMs: nowMs,
                    updatedAtMs: nowMs,
                    lastSeenAtMs: nowMs
                ),
                at: 0
            )
        }

        persistCache()
        lastSyncAt = Date()
    }

    private func performRefresh(auth: AuthenticationManager) async {
        if isOfflineMode {
            loadCache()
            return
        }
        guard let session = auth.session, !session.idToken.isEmpty else {
            loadCache()
            return
        }
        guard let base = BackendUrl.resolve() else {
            lastError = "Missing backend URL"
            loadCache()
            return
        }

        do {
            var url = base
            url.appendPathComponent("v1")
            url.appendPathComponent("devices")
            url.appendPathComponent("my")

            var req = URLRequest(url: url)
            req.httpMethod = "GET"
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.setValue("Bearer \(session.idToken)", forHTTPHeaderField: "Authorization")

            let (data, res) = try await URLSession.shared.data(for: req)
            let code = (res as? HTTPURLResponse)?.statusCode ?? -1
            guard code >= 200 && code < 300 else {
                let msg = String(data: data, encoding: .utf8) ?? ""
                throw NSError(domain: "AccountDevicesService", code: code, userInfo: [
                    NSLocalizedDescriptionKey: msg.isEmpty ? "Device list fetch failed (HTTP \(code))" : msg
                ])
            }

            let decoded = try JSONDecoder().decode(DevicesResponse.self, from: data)
            devices = decoded.devices
            persistCache()
            lastSyncAt = Date()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
            loadCache()
        }
    }

    private func persistCache() {
        guard let data = try? JSONEncoder().encode(devices) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }

    private func loadCache() {
        guard let data = UserDefaults.standard.data(forKey: cacheKey),
              let decoded = try? JSONDecoder().decode([DeviceRecord].self, from: data) else {
            devices = []
            return
        }
        devices = decoded
    }

    private func normalized(_ value: String?) -> String {
        (value ?? "").replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
            .uppercased()
    }
}
