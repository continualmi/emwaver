import Combine
import Foundation
import Network

@MainActor
final class AccountDevicesService: ObservableObject {
    struct DeviceRecord: Codable, Identifiable {
        var id: String { cacheKey }
        let label: String
        let boardType: String?
        let hardwareUid: String?
        let createdAtMs: Int64
        let updatedAtMs: Int64
        let lastSeenAtMs: Int64

        enum CodingKeys: String, CodingKey {
            case label
            case boardType = "board_type"
            case hardwareUid = "hardware_uid"
            case createdAtMs = "created_at_ms"
            case updatedAtMs = "updated_at_ms"
            case lastSeenAtMs = "last_seen_at_ms"
        }

        init(
            label: String,
            boardType: String?,
            hardwareUid: String?,
            createdAtMs: Int64,
            updatedAtMs: Int64,
            lastSeenAtMs: Int64
        ) {
            self.label = label
            self.boardType = boardType
            self.hardwareUid = hardwareUid
            self.createdAtMs = createdAtMs
            self.updatedAtMs = updatedAtMs
            self.lastSeenAtMs = lastSeenAtMs
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.label = try container.decodeIfPresent(String.self, forKey: .label) ?? "EMWaver device"
            self.boardType = try container.decodeIfPresent(String.self, forKey: .boardType)
            self.hardwareUid = try container.decodeIfPresent(String.self, forKey: .hardwareUid)
            self.createdAtMs = try container.decodeIfPresent(Int64.self, forKey: .createdAtMs) ?? 0
            self.updatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .updatedAtMs) ?? 0
            self.lastSeenAtMs = try container.decodeIfPresent(Int64.self, forKey: .lastSeenAtMs) ?? 0
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(label, forKey: .label)
            try container.encodeIfPresent(boardType, forKey: .boardType)
            try container.encodeIfPresent(hardwareUid, forKey: .hardwareUid)
            try container.encode(createdAtMs, forKey: .createdAtMs)
            try container.encode(updatedAtMs, forKey: .updatedAtMs)
            try container.encode(lastSeenAtMs, forKey: .lastSeenAtMs)
        }

        private var cacheKey: String {
            "\(boardType ?? ""):\(hardwareUid ?? "")"
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
    private var seenSyncTasks: [String: Task<Void, Never>] = [:]

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

        auth.$accessToken
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

    func storeClaimedDevice(boardType: String, hardwareUid: String) {
        let normalizedUid = normalized(hardwareUid)
        let normalizedBoardType = boardType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

        if let index = devices.firstIndex(where: {
            $0.boardType?.caseInsensitiveCompare(normalizedBoardType) == .orderedSame &&
            normalized($0.hardwareUid) == normalizedUid
        }) {
            let existing = devices[index]
            devices[index] = DeviceRecord(
                label: existing.label.isEmpty ? "EMWaver device" : existing.label,
                boardType: normalizedBoardType,
                hardwareUid: normalizedUid,
                createdAtMs: existing.createdAtMs,
                updatedAtMs: nowMs,
                lastSeenAtMs: nowMs
            )
        } else {
            devices.insert(
                DeviceRecord(
                    label: "EMWaver device",
                    boardType: normalizedBoardType,
                    hardwareUid: normalizedUid,
                    createdAtMs: nowMs,
                    updatedAtMs: nowMs,
                    lastSeenAtMs: nowMs
                ),
                at: 0
            )
        }

        devices = dedupeDevices(devices)
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

    func syncSeenDevice(boardType: String, hardwareUid: String, auth: AuthenticationManager) {
        let normalizedBoardType = boardType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let normalizedUid = normalized(hardwareUid)
        guard !normalizedBoardType.isEmpty, !normalizedUid.isEmpty else { return }
        guard !isOfflineMode else { return }
        guard !auth.accessToken.isEmpty else { return }
        guard let base = BackendUrl.resolve() else { return }
        guard !hasOfflineAccess(boardType: normalizedBoardType, hardwareUid: normalizedUid) else { return }

        let key = "\(normalizedBoardType):\(normalizedUid):\(auth.account?.uid ?? "unknown")"
        guard seenSyncTasks[key] == nil else { return }

        seenSyncTasks[key] = Task { [weak self] in
            defer {
                Task { @MainActor [weak self] in
                    self?.seenSyncTasks[key] = nil
                }
            }

            do {
                var url = base
                url.appendPathComponent("v1")
                url.appendPathComponent("devices")
                url.appendPathComponent("seen")

                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("Bearer \(auth.accessToken)", forHTTPHeaderField: "Authorization")
                req.httpBody = try JSONSerialization.data(withJSONObject: [
                    "board_type": normalizedBoardType,
                    "hardware_uid": normalizedUid,
                ])

                let (_, res) = try await URLSession.shared.data(for: req)
                let code = (res as? HTTPURLResponse)?.statusCode ?? -1
                guard code >= 200 && code < 300 else { return }

                await MainActor.run {
                    self?.storeClaimedDevice(boardType: normalizedBoardType, hardwareUid: normalizedUid)
                }
            } catch {
                // Keep auto-restore silent; manual refresh will surface broader account errors.
            }
        }
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
        guard !auth.accessToken.isEmpty else {
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
            req.setValue("Bearer \(auth.accessToken)", forHTTPHeaderField: "Authorization")

            let (data, res) = try await URLSession.shared.data(for: req)
            let code = (res as? HTTPURLResponse)?.statusCode ?? -1
            guard code >= 200 && code < 300 else {
                if code == 401 {
                    auth.handleUnauthorizedResponse()
                }
                let msg = String(data: data, encoding: .utf8) ?? ""
                throw NSError(domain: "AccountDevicesService", code: code, userInfo: [
                    NSLocalizedDescriptionKey: msg.isEmpty ? "Device list fetch failed (HTTP \(code))" : msg
                ])
            }

            let decoded = try JSONDecoder().decode(DevicesResponse.self, from: data)
            devices = dedupeDevices(decoded.devices)
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
        devices = dedupeDevices(decoded)
        persistCache()
        hasLoadedOnce = true
    }

    private func mergeBackendDevices(_ backend: [DeviceRecord], preserving local: [DeviceRecord]) -> [DeviceRecord] {
        var merged = dedupeDevices(backend)

        for localRecord in local {
            guard let localKey = recordKey(for: localRecord) else {
                if !merged.contains(where: { recordKey(for: $0) == nil && $0.label == localRecord.label }) {
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

    private func dedupeDevices(_ input: [DeviceRecord]) -> [DeviceRecord] {
        var deduped: [String: DeviceRecord] = [:]
        var anonymous: [DeviceRecord] = []

        for record in input {
            guard let key = recordKey(for: record) else {
                if !anonymous.contains(where: { $0.label == record.label && $0.lastSeenAtMs == record.lastSeenAtMs }) {
                    anonymous.append(record)
                }
                continue
            }

            let normalizedRecord = DeviceRecord(
                label: record.label.isEmpty ? "EMWaver device" : record.label,
                boardType: record.boardType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                hardwareUid: normalized(record.hardwareUid),
                createdAtMs: record.createdAtMs,
                updatedAtMs: record.updatedAtMs,
                lastSeenAtMs: record.lastSeenAtMs
            )

            if let existing = deduped[key] {
                deduped[key] = DeviceRecord(
                    label: existing.label.isEmpty ? normalizedRecord.label : existing.label,
                    boardType: existing.boardType ?? normalizedRecord.boardType,
                    hardwareUid: existing.hardwareUid ?? normalizedRecord.hardwareUid,
                    createdAtMs: min(existing.createdAtMs, normalizedRecord.createdAtMs),
                    updatedAtMs: max(existing.updatedAtMs, normalizedRecord.updatedAtMs),
                    lastSeenAtMs: max(existing.lastSeenAtMs, normalizedRecord.lastSeenAtMs)
                )
            } else {
                deduped[key] = normalizedRecord
            }
        }

        return (Array(deduped.values) + anonymous).sorted {
            if $0.lastSeenAtMs != $1.lastSeenAtMs {
                return $0.lastSeenAtMs > $1.lastSeenAtMs
            }
            return $0.updatedAtMs > $1.updatedAtMs
        }
    }

    private func recordKey(for record: DeviceRecord) -> String? {
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
