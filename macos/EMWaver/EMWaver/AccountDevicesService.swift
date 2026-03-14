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
    @Published private(set) var isRefreshing: Bool = false
    @Published private(set) var hasLoadedOnce: Bool = false

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
        isRefreshing = true
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

        if let index = devices.firstIndex(where: { $0.deviceIdB64 == deviceIdB64 }) {
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
        } else if let index = devices.firstIndex(where: {
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
        hasLoadedOnce = true
    }

    func claimStatusResolved(boardType: String, hardwareUid: String, signedIn: Bool) -> Bool {
        if hasOfflineAccess(boardType: boardType, hardwareUid: hardwareUid) {
            return true
        }
        if isOfflineMode || !signedIn {
            return true
        }
        if isRefreshing {
            return false
        }
        return hasLoadedOnce
    }

    private func performRefresh(auth: AuthenticationManager) async {
        defer {
            isRefreshing = false
            hasLoadedOnce = true
        }

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
            devices = mergeBackendDevices(decoded.devices, preserving: devices)
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
            hasLoadedOnce = true
            return
        }
        devices = decoded
        hasLoadedOnce = true
    }

    private func mergeBackendDevices(_ backend: [DeviceRecord], preserving local: [DeviceRecord]) -> [DeviceRecord] {
        var merged = backend

        for localRecord in local {
            guard let localKey = recordKey(for: localRecord) else {
                if !merged.contains(where: { $0.deviceIdB64 == localRecord.deviceIdB64 }) {
                    merged.append(localRecord)
                }
                continue
            }

            if let index = merged.firstIndex(where: { record in
                guard let key = recordKey(for: record) else { return false }
                return key == localKey
            }) {
                let backendRecord = merged[index]
                merged[index] = DeviceRecord(
                    deviceIdB64: backendRecord.deviceIdB64.isEmpty ? localRecord.deviceIdB64 : backendRecord.deviceIdB64,
                    label: backendRecord.label.isEmpty ? localRecord.label : backendRecord.label,
                    boardType: backendRecord.boardType ?? localRecord.boardType,
                    hardwareUid: backendRecord.hardwareUid ?? localRecord.hardwareUid,
                    createdAtMs: min(backendRecord.createdAtMs, localRecord.createdAtMs),
                    updatedAtMs: max(backendRecord.updatedAtMs, localRecord.updatedAtMs),
                    lastSeenAtMs: max(backendRecord.lastSeenAtMs, localRecord.lastSeenAtMs)
                )
            } else {
                merged.append(localRecord)
            }
        }

        return merged.sorted {
            if $0.lastSeenAtMs != $1.lastSeenAtMs {
                return $0.lastSeenAtMs > $1.lastSeenAtMs
            }
            return $0.updatedAtMs > $1.updatedAtMs
        }
    }

    private func recordKey(for record: DeviceRecord) -> String? {
        if !record.deviceIdB64.isEmpty {
            return "id:\(record.deviceIdB64)"
        }
        guard let boardType = record.boardType, !boardType.isEmpty else { return nil }
        let hardwareUid = normalized(record.hardwareUid)
        guard !hardwareUid.isEmpty else { return nil }
        return "uid:\(boardType.uppercased()):\(hardwareUid)"
    }

    private func normalized(_ value: String?) -> String {
        (value ?? "").replacingOccurrences(of: ":", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
            .uppercased()
    }
}
