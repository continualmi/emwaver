import Combine
import Foundation

import EMWaverScriptRuntime
import EMWaverScriptModel

@MainActor
private final class TargetedScriptDevice: ScriptDevice {
    private weak var base: MacUSBManager?
    private let deviceID: String?

    init(base: MacUSBManager, deviceID: String?) {
        self.base = base
        self.deviceID = deviceID
    }

    func getBuffer() -> Data { base?.getBuffer(deviceID: deviceID) ?? Data() }
    func clearBuffer() { base?.clearBuffer(deviceID: deviceID) }
    func loadBuffer(data: Data) { base?.loadBuffer(data: data, deviceID: deviceID) }
    func sendPacket(_ data: Data) { base?.sendPacket(data, deviceID: deviceID) }
    func sendCommand(_ command: Data, timeout: Int) -> Data? { base?.sendCommand(command, timeout: timeout, deviceID: deviceID) }
    func transmitBuffer() { base?.transmitBuffer(deviceID: deviceID) }
}

@MainActor
private final class RemoteScriptSession {
    let manager: ScriptPreviewManager
    let deviceID: String?
    var uiRev: Int = 0
    var cancellable: AnyCancellable?

    init(manager: ScriptPreviewManager, deviceID: String?) {
        self.manager = manager
        self.deviceID = deviceID
    }
}

struct RemoteScriptSessionSummary: Identifiable, Equatable {
    let id: String
    let name: String
    let deviceID: String?
}

@MainActor
final class RemoteControlHostService: ObservableObject {
    static let localGatewayEnabledKey = "emwaver.localGateway.enabled"

    @Published private(set) var isRemoteControlled: Bool = false
    @Published private(set) var remoteScriptTree: ScriptTree?
    @Published private(set) var remoteActiveScriptName: String?
    @Published private(set) var remoteScriptSessions: [RemoteScriptSessionSummary] = []
    @Published private(set) var selectedRemoteScriptInstanceId: String?
    private let urlSession: URLSession

    private weak var device: MacUSBManager?
    private weak var hostSessions: HostSessionManager?

    private var socket: URLSessionWebSocketTask?
    private var reconnectTask: Task<Void, Never>?

    private var previewManager: ScriptPreviewManager?
    private var treeCancellable: AnyCancellable?
    private var deviceStatusCancellable: AnyCancellable?
    private var remoteSessionsByScriptId: [String: RemoteScriptSession] = [:]

    private var uiRev: Int = 0

    private struct HostSocketConfig {
        let wsURL: URL
    }

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func start(auth: AuthenticationManager, device: MacUSBManager, hostSessions: HostSessionManager, previewManager: ScriptPreviewManager) {
        self.device = device
        self.hostSessions = hostSessions
        self.previewManager = previewManager

        previewManager.attach(device: device)

        // Stream UI snapshots whenever the scriptTree updates.
        treeCancellable = previewManager.$scriptTree
            .receive(on: DispatchQueue.main)
            .sink { [weak self] tree in
                guard let self else { return }
                self.remoteScriptTree = tree
                self.remoteActiveScriptName = previewManager.activeScriptName
                guard let scriptId = previewManager.activeScriptInstanceId else { return }
                self.uiRev += 1
                self.sendJson([
                    "type": "ui.snapshot",
                    "hostSessionId": hostSessions.hostSessionId,
                    "scriptInstanceId": scriptId,
                    "rev": self.uiRev,
                    "root": tree.map { self.encodeNode($0.root) } ?? NSNull(),
                    "metadata": tree?.metadata ?? [:],
                ])
            }

        deviceStatusCancellable = device.$discoveredDevices
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.sendDeviceStatus()
            }

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            await self.reconnectLoop()
        }
    }

    func stop() {
        reconnectTask?.cancel()
        reconnectTask = nil
        treeCancellable?.cancel()
        treeCancellable = nil
        deviceStatusCancellable?.cancel()
        deviceStatusCancellable = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        for session in remoteSessionsByScriptId.values {
            session.cancellable?.cancel()
            session.manager.exitPreview()
        }
        remoteSessionsByScriptId.removeAll()
        refreshRemoteSessionSummaries()
    }

    private func sendDeviceStatus() {
        guard let device else { return }
        sendJson([
            "type": "device.status",
            "hostSessionId": hostSessions?.hostSessionId ?? "local",
            "connected": device.isConnected,
            "runtimeOwner": "native-app",
            "devices": device.discoveredDevices.map { d in
                [
                    "id": d.id,
                    "name": d.displayName,
                    "transport": d.transport.rawValue,
                    "boardType": d.boardType ?? "",
                    "connected": d.connectionState == .connected,
                    "isActive": d.isActive,
                ] as [String: Any]
            },
        ])
    }

    private func hostSocketConfig() -> HostSocketConfig? {
        localGatewayWsURL().map { HostSocketConfig(wsURL: $0) }
    }

    private func isLocalGatewayEnabled() -> Bool {
        let env = ProcessInfo.processInfo.environment
        if env["EMWAVER_LOCAL_GATEWAY_DISABLED"] == "1" {
            return false
        }
        if env["EMWAVER_LOCAL_GATEWAY_AUTO_CONNECT"] == "1" {
            return true
        }
        return UserDefaults.standard.bool(forKey: Self.localGatewayEnabledKey)
    }

    private func localGatewayWsURL() -> URL? {
        let env = ProcessInfo.processInfo.environment
        if !isLocalGatewayEnabled() {
            return nil
        }

        let raw = env["EMWAVER_LOCAL_GATEWAY_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = "ws://127.0.0.1:3921/v1/ws"
        let rawURL = (raw?.isEmpty == false) ? (raw ?? fallback) : fallback
        guard let input = URL(string: rawURL) else { return nil }
        guard var comps = URLComponents(url: input, resolvingAgainstBaseURL: false) else { return nil }

        if comps.scheme == "http" {
            comps.scheme = "ws"
        } else if comps.scheme == "https" {
            comps.scheme = "wss"
        }

        guard comps.scheme == "ws" || comps.scheme == "wss" else { return nil }
        if comps.path.isEmpty || comps.path == "/" {
            comps.path = "/v1/ws"
        }

        return comps.url
    }

    private func reconnectLoop() async {
        var retryDelay: UInt64 = 1_000_000_000
        let maxRetryDelay: UInt64 = 30_000_000_000

        while !Task.isCancelled {
            guard isLocalGatewayEnabled() else {
                if socket != nil {
                    socket?.cancel(with: .goingAway, reason: nil)
                    socket = nil
                    isRemoteControlled = false
                }
                retryDelay = 1_000_000_000
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }

            if socket == nil {
                let receivedMessage = await connectOnce()
                retryDelay = receivedMessage ? 1_000_000_000 : min(retryDelay * 2, maxRetryDelay)
            }

            try? await Task.sleep(nanoseconds: retryDelay)
        }
    }

    private func connectOnce() async -> Bool {
        guard let cfg = hostSocketConfig() else { return false }
        guard let hostSessions else { return false }

        let task = urlSession.webSocketTask(with: cfg.wsURL)
        socket = task
        task.resume()

        // Hello
        sendJson([
            "type": "hello",
            "role": "app",
            "protocolVersion": 1,
            "hostSessionId": hostSessions.hostSessionId,
        ])
        sendDeviceStatus()

        // Start receive loop.
        let receivedMessage = await receiveLoop()

        // If receive loop exits, close and retry.
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        isRemoteControlled = false
        return receivedMessage
    }

    private func receiveLoop() async -> Bool {
        var receivedMessage = false

        while !Task.isCancelled, let socket {
            do {
                let msg = try await socket.receive()
                receivedMessage = true
                switch msg {
                case .string(let s):
                    handleIncoming(text: s)
                case .data(let d):
                    if let s = String(data: d, encoding: .utf8) {
                        handleIncoming(text: s)
                    }
                @unknown default:
                    break
                }
            } catch {
                break
            }
        }

        return receivedMessage
    }

    private func handleIncoming(text: String) {
        guard let data = text.data(using: .utf8) else { return }
        guard let objAny = try? JSONSerialization.jsonObject(with: data) else { return }
        guard let obj = objAny as? [String: Any] else { return }

        let type = (obj["type"] as? String) ?? ""

        switch type {
        case "host.attach":
            // Mark host as being remotely controlled (used for local UX).
            isRemoteControlled = true

            // If a script is already running locally, tell the controller immediately.
            if let pm = previewManager,
               let sid = pm.activeScriptInstanceId,
               !sid.isEmpty {
                sendJson([
                    "type": "script.started",
                    "hostSessionId": hostSessions?.hostSessionId ?? "",
                    "scriptInstanceId": sid,
                    "name": pm.activeScriptName ?? "",
                ])

                // Also send the latest UI snapshot immediately (in case the UI is stable and
                // the controller attached mid-run).
                if let tree = pm.scriptTree {
                    uiRev += 1
                    sendJson([
                        "type": "ui.snapshot",
                        "hostSessionId": hostSessions?.hostSessionId ?? "",
                        "scriptInstanceId": sid,
                        "rev": uiRev,
                        "root": self.encodeNode(tree.root),
                        "metadata": tree.metadata,
                    ])
                }
            }
            return

        case "script.run":
            guard let source = obj["source"] as? String else {
                sendJson(["type": "script.error", "error": "missing_source", "hostSessionId": hostSessions?.hostSessionId ?? ""])
                return
            }
            let name = (obj["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let deviceID = (obj["deviceId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            startRemoteScript(source: source, name: name, deviceID: deviceID?.isEmpty == false ? deviceID : nil)

        case "ui.event":
            guard let scriptInstanceId = obj["scriptInstanceId"] as? String else { return }
            guard let previewManager = previewManager(for: scriptInstanceId) else { return }
            guard let targetNodeId = obj["targetNodeId"] as? String else { return }
            guard let name = obj["name"] as? String else { return }
            let payload = obj["payload"] as? [String: Any] ?? [:]

            // Special-case plot viewport requests: the web controller does not hold the plot buffer,
            // so it asks the host to compute a compressed viewport and send back points.
            if name == "viewport" {
                // First, let the script handle it (if it has a handler) so the host UI stays in sync.
                // Then, also compute the compressed viewport for the web renderer.
                dispatchUiEvent(previewManager: previewManager, targetNodeId: targetNodeId, name: name, payload: payload)
                _ = handlePlotViewportRequest(previewManager: previewManager, targetNodeId: targetNodeId, payload: payload)
                return
            }

            dispatchUiEvent(previewManager: previewManager, targetNodeId: targetNodeId, name: name, payload: payload)

        case "plot.viewport":
            // Host-side plot viewport computation only (no script handler invocation).
            guard let scriptInstanceId = obj["scriptInstanceId"] as? String else { return }
            guard let previewManager = previewManager(for: scriptInstanceId) else { return }
            guard let targetNodeId = obj["targetNodeId"] as? String else { return }
            let payload = obj["payload"] as? [String: Any] ?? [:]
            _ = handlePlotViewportRequest(previewManager: previewManager, targetNodeId: targetNodeId, payload: payload)
            return

        case "script.stop":
            let requestedId = obj["scriptInstanceId"] as? String
            let currentId = requestedId ?? previewManager?.activeScriptInstanceId ?? ""
            if !currentId.isEmpty, let session = remoteSessionsByScriptId.removeValue(forKey: currentId) {
                session.cancellable?.cancel()
                session.manager.exitPreview()
                if selectedRemoteScriptInstanceId == currentId {
                    selectedRemoteScriptInstanceId = remoteSessionsByScriptId.keys.sorted().first
                    if let selectedRemoteScriptInstanceId {
                        selectRemoteSession(selectedRemoteScriptInstanceId)
                    } else {
                        remoteScriptTree = nil
                        remoteActiveScriptName = nil
                    }
                }
                refreshRemoteSessionSummaries()
                sendJson([
                    "type": "script.stopped",
                    "hostSessionId": hostSessions?.hostSessionId ?? "",
                    "scriptInstanceId": currentId,
                    "deviceId": session.deviceID ?? "",
                    "reason": "stopped_by_controller",
                ])
            } else if !currentId.isEmpty, let previewManager, currentId == previewManager.activeScriptInstanceId {
                previewManager.exitPreview()
                sendJson([
                    "type": "script.stopped",
                    "hostSessionId": hostSessions?.hostSessionId ?? "",
                    "scriptInstanceId": currentId,
                    "reason": "stopped_by_controller",
                ])
            }
            return

        default:
            return
        }
    }

    func selectRemoteSession(_ scriptInstanceId: String) {
        guard let session = remoteSessionsByScriptId[scriptInstanceId] else { return }
        selectedRemoteScriptInstanceId = scriptInstanceId
        remoteScriptTree = session.manager.scriptTree
        remoteActiveScriptName = session.manager.activeScriptName
    }

    func stopRemoteSession(_ scriptInstanceId: String) {
        guard let session = remoteSessionsByScriptId.removeValue(forKey: scriptInstanceId) else { return }
        session.cancellable?.cancel()
        session.manager.exitPreview()
        if selectedRemoteScriptInstanceId == scriptInstanceId {
            selectedRemoteScriptInstanceId = remoteSessionsByScriptId.keys.sorted().first
            if let selectedRemoteScriptInstanceId {
                selectRemoteSession(selectedRemoteScriptInstanceId)
            } else {
                remoteScriptTree = nil
                remoteActiveScriptName = nil
            }
        }
        refreshRemoteSessionSummaries()
        sendJson([
            "type": "script.stopped",
            "hostSessionId": hostSessions?.hostSessionId ?? "",
            "scriptInstanceId": scriptInstanceId,
            "deviceId": session.deviceID ?? "",
            "reason": "stopped_in_app",
        ])
    }

    private func refreshRemoteSessionSummaries() {
        remoteScriptSessions = remoteSessionsByScriptId
            .map { id, session in
                RemoteScriptSessionSummary(
                    id: id,
                    name: session.manager.activeScriptName ?? "Script",
                    deviceID: session.deviceID
                )
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func previewManager(for scriptInstanceId: String) -> ScriptPreviewManager? {
        if let session = remoteSessionsByScriptId[scriptInstanceId] {
            return session.manager
        }
        if previewManager?.activeScriptInstanceId == scriptInstanceId {
            return previewManager
        }
        return nil
    }

    private func startRemoteScript(source: String, name: String?, deviceID: String?) {
        guard let device else { return }

        let manager = ScriptPreviewManager()
        manager.attach(device: TargetedScriptDevice(base: device, deviceID: deviceID))
        let session = RemoteScriptSession(manager: manager, deviceID: deviceID)

        session.cancellable = manager.$scriptTree
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak session, weak manager] tree in
                guard let self, let session, let manager else { return }
                guard let scriptId = manager.activeScriptInstanceId else { return }
                session.uiRev += 1
                if self.selectedRemoteScriptInstanceId == scriptId {
                    self.remoteScriptTree = tree
                    self.remoteActiveScriptName = manager.activeScriptName
                }
                self.refreshRemoteSessionSummaries()
                self.sendJson([
                    "type": "ui.snapshot",
                    "hostSessionId": self.hostSessions?.hostSessionId ?? "",
                    "scriptInstanceId": scriptId,
                    "deviceId": session.deviceID ?? "",
                    "rev": session.uiRev,
                    "root": tree.map { self.encodeNode($0.root) } ?? NSNull(),
                    "metadata": tree?.metadata ?? [:],
                ])
            }

        manager.render(script: source, name: name, moduleSources: [:])
        guard let scriptId = manager.activeScriptInstanceId else { return }
        remoteSessionsByScriptId[scriptId] = session
        selectedRemoteScriptInstanceId = scriptId
        remoteScriptTree = manager.scriptTree
        remoteActiveScriptName = manager.activeScriptName
        refreshRemoteSessionSummaries()

        if let name, !name.isEmpty {
            UserDefaults.standard.set(name, forKey: "emwaver.remote.activeScriptName")
        }

        sendJson([
            "type": "script.started",
            "hostSessionId": hostSessions?.hostSessionId ?? "",
            "scriptInstanceId": scriptId,
            "deviceId": deviceID ?? "",
            "name": name ?? "",
        ])
    }

    /// Invoke a handler token coming from a locally-rendered ScriptRenderView.
    ///
    /// This is used for the in-app “Remote Control” overlay so the host can
    /// interact with the remotely-running script UI while the web client is also
    /// attached.
    func invokeRemoteHandler(token: String, arguments: [Any]) {
        guard let selectedRemoteScriptInstanceId,
              let manager = previewManager(for: selectedRemoteScriptInstanceId) else { return }
        manager.invoke(token: token, arguments: arguments)
    }

    private func dispatchUiEvent(previewManager: ScriptPreviewManager, targetNodeId: String, name: String, payload: [String: Any]) {
        guard let tree = previewManager.scriptTree else { return }

        guard let ev = ScriptEventType(rawValue: name) else { return }
        guard let node = findNode(in: tree.root, id: targetNodeId) else { return }
        guard let token = node.props.handlerId(for: ev) else { return }

        var args: [Any] = []
        if ev == .change || ev == .select || ev == .submit {
            if let v = payload["value"] {
                args = [v]
            }
        } else if ev == .viewport {
            // Viewport payloads are forwarded as-is (dictionary).
            if let v = payload["value"] {
                args = [v]
            } else if !payload.isEmpty {
                args = [payload]
            }
        }

        previewManager.invoke(token: token, arguments: args)
    }

    /// Handle a web plot viewport request by computing a compressed viewport on the host.
    /// Returns true if the request was understood and handled.
    private func handlePlotViewportRequest(previewManager: ScriptPreviewManager, targetNodeId: String, payload: [String: Any]) -> Bool {
        guard let scriptInstanceId = previewManager.activeScriptInstanceId else { return false }
        guard let tree = previewManager.scriptTree else { return false }
        guard let node = findNode(in: tree.root, id: targetNodeId) else { return false }
        guard node.type == .plot else { return false }

        let raw = node.props.raw
        guard let sourceId = extractPlotSourceId(raw["source"]) else {
            sendJson([
                "type": "plot.data",
                "scriptInstanceId": scriptInstanceId,
                "targetNodeId": targetNodeId,
                "error": "missing_source",
            ])
            return true
        }

        let bytes = PlotBufferStore.shared.getBytes(id: sourceId)
        let totalBits = max(0, bytes.count * 8)
        if totalBits <= 0 {
            sendJson([
                "type": "plot.data",
                "scriptInstanceId": scriptInstanceId,
                "targetNodeId": targetNodeId,
                "xBoundsMin": 0,
                "xBoundsMax": 0,
                "xMin": 0,
                "xMax": 0,
                "dataX": [],
                "dataY": [],
            ])
            return true
        }

        let bounds = extractPlotBounds(raw) ?? (0.0...Double(totalBits))

        let reqMin = extractDouble(payload["min"]) ?? extractDouble(payload["xMin"]) ?? bounds.lowerBound
        let reqMax = extractDouble(payload["max"]) ?? extractDouble(payload["xMax"]) ?? bounds.upperBound
        var xMin = min(reqMin, reqMax)
        var xMax = max(reqMin, reqMax)

        // Clamp to bounds.
        xMin = max(bounds.lowerBound, min(bounds.upperBound, xMin))
        xMax = max(bounds.lowerBound, min(bounds.upperBound, xMax))
        if xMax <= xMin {
            xMax = min(bounds.upperBound, xMin + 1)
        }

        let defaultBins = 400
        let requestedBins = extractInt(payload["bins"]) ?? defaultBins
        let bins = max(16, min(12_000, requestedBins))

        let startBit = max(0, min(totalBits, Int(floor(xMin))))
        let endBit = max(startBit, min(totalBits, Int(ceil(xMax))))
        let span = max(0, endBit - startBit)

        if span <= 0 {
            sendJson([
                "type": "plot.data",
                "scriptInstanceId": scriptInstanceId,
                "targetNodeId": targetNodeId,
                "xBoundsMin": bounds.lowerBound,
                "xBoundsMax": bounds.upperBound,
                "xMin": xMin,
                "xMax": xMax,
                "dataX": [],
                "dataY": [],
            ])
            return true
        }

        let clampedBins = max(1, min(bins, span))
        let (xs, ys) = compressBits(bytes: bytes, startBit: startBit, endBit: endBit, bins: clampedBins)

        sendJson([
            "type": "plot.data",
            "scriptInstanceId": scriptInstanceId,
            "targetNodeId": targetNodeId,
            "xBoundsMin": bounds.lowerBound,
            "xBoundsMax": bounds.upperBound,
            "xMin": xMin,
            "xMax": xMax,
            "bins": clampedBins,
            "dataX": xs,
            "dataY": ys,
        ])

        return true
    }

    private func extractPlotSourceId(_ value: Any?) -> String? {
        if let s = value as? String {
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let dict = value as? [String: Any] {
            if let kind = dict["kind"] as? String {
                if kind == "samplerBits" {
                    return "samplerBits"
                }
                if kind == "buffer" {
                    if let id = dict["id"] as? String {
                        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
                        return trimmed.isEmpty ? nil : trimmed
                    }
                }
            }
            if let id = dict["id"] as? String {
                let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
        }
        return nil
    }

    private func extractPlotBounds(_ raw: [String: Any]) -> ClosedRange<Double>? {
        let minV = extractDouble(raw["xBoundsMin"]) ?? extractDouble(raw["xDomainMin"])
        let maxV = extractDouble(raw["xBoundsMax"]) ?? extractDouble(raw["xDomainMax"])
        guard let minV, let maxV, minV.isFinite, maxV.isFinite, maxV > minV else {
            return nil
        }
        return minV...maxV
    }

    private func extractDouble(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let s = value as? String { return Double(s) }
        return nil
    }

    private func extractInt(_ value: Any?) -> Int? {
        if let n = value as? NSNumber { return n.intValue }
        if let i = value as? Int { return i }
        if let s = value as? String { return Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }

    private func compressBits(bytes: Data, startBit: Int, endBit: Int, bins: Int) -> ([Double], [Double]) {
        let span = max(0, endBit - startBit)
        if span <= 0 {
            return ([], [])
        }

        func bitAt(_ idx: Int) -> Int {
            let byteIndex = idx >> 3
            let bitIndex = idx & 7
            guard byteIndex >= 0, byteIndex < bytes.count else { return 0 }
            let byte = bytes[bytes.index(bytes.startIndex, offsetBy: byteIndex)]
            return ((byte >> bitIndex) & 1) == 1 ? 1 : 0
        }

        var timeValues: [Double] = []
        var dataValues: [Double] = []

        if span <= bins * 2 {
            timeValues.reserveCapacity(span)
            dataValues.reserveCapacity(span)
            for i in startBit..<endBit {
                timeValues.append(Double(i))
                dataValues.append(bitAt(i) == 1 ? 255.0 : 0.0)
            }
            return (timeValues, dataValues)
        }

        let binWidth = Double(span) / Double(bins)
        timeValues.reserveCapacity(bins * 2)
        dataValues.reserveCapacity(bins * 2)

        for bin in 0..<bins {
            let binStart = Int(floor(Double(startBit) + Double(bin) * binWidth))
            var binEnd = Int(floor(Double(binStart) + binWidth))
            if binEnd > endBit { binEnd = endBit }
            if binEnd <= binStart { continue }

            var hasLow = false
            var hasHigh = false

            var i = binStart
            while i < binEnd {
                let byteIndex = i >> 3
                if byteIndex >= bytes.count { break }

                if (i & 7) == 0, i + 8 <= binEnd {
                    let byte = bytes[bytes.index(bytes.startIndex, offsetBy: byteIndex)]
                    if byte == 0 {
                        hasLow = true
                    } else if byte == 255 {
                        hasHigh = true
                    } else {
                        hasLow = true
                        hasHigh = true
                    }
                    i += 8
                } else {
                    if bitAt(i) == 1 {
                        hasHigh = true
                    } else {
                        hasLow = true
                    }
                    i += 1
                }

                if hasLow, hasHigh { break }
            }

            if hasLow || hasHigh {
                timeValues.append(Double(binStart))
                dataValues.append(hasLow ? 0.0 : 255.0)
                timeValues.append(Double(max(binStart, binEnd - 1)))
                dataValues.append(hasHigh ? 255.0 : 0.0)
            }
        }
        return (timeValues, dataValues)
    }

    private func findNode(in node: ScriptNode, id: String) -> ScriptNode? {
        if node.id == id { return node }
        for c in node.children {
            if let found = findNode(in: c, id: id) { return found }
        }
        return nil
    }

    private func encodeNode(_ node: ScriptNode) -> [String: Any] {
        var out: [String: Any] = [
            "id": node.id,
            "type": node.type.rawValue,
            "props": node.props.raw,
        ]

        if !node.props.eventHandlers.isEmpty {
            var handlers: [String: String] = [:]
            for (k, v) in node.props.eventHandlers {
                handlers[k.rawValue] = v
            }
            out["handlers"] = handlers
        }

        if !node.children.isEmpty {
            out["children"] = node.children.map { encodeNode($0) }
        }

        return out
    }

    private func sendJson(_ obj: [String: Any]) {
        guard let socket else { return }
        guard JSONSerialization.isValidJSONObject(obj) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        guard let text = String(data: data, encoding: .utf8) else { return }

        socket.send(.string(text)) { _ in }
    }
}
