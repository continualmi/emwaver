import Combine
import Foundation

import EMWaverScriptRuntime
import EMWaverScriptModel

@MainActor
final class RemoteControlHostService: ObservableObject {
    @Published private(set) var isRemoteControlled: Bool = false
    @Published private(set) var remoteScriptTree: ScriptTree?
    @Published private(set) var remoteActiveScriptName: String?
    private let urlSession: URLSession

    private weak var auth: AuthenticationManager?
    private weak var device: MacUSBManager?
    private weak var hostSessions: HostSessionManager?

    private var socket: URLSessionWebSocketTask?
    private var reconnectTask: Task<Void, Never>?

    private let previewManager = ScriptPreviewManager()
    private var treeCancellable: AnyCancellable?

    private var activeScriptInstanceId: String?
    private var uiRev: Int = 0

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func start(auth: AuthenticationManager, device: MacUSBManager, hostSessions: HostSessionManager) {
        self.auth = auth
        self.device = device
        self.hostSessions = hostSessions

        previewManager.attach(device: device)

        // Stream UI snapshots whenever the scriptTree updates.
        treeCancellable = previewManager.$scriptTree
            .receive(on: DispatchQueue.main)
            .sink { [weak self] tree in
                guard let self else { return }
                self.remoteScriptTree = tree
                self.remoteActiveScriptName = self.previewManager.activeScriptName
                guard let scriptId = self.activeScriptInstanceId else { return }
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
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    private func backendConfig() -> (wsURL: URL, accessToken: String)? {
        guard let auth else { return nil }
        guard let hostSessions else { return nil }

        // Same resolution order as macOS ContentView.
        let envURL = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let defaultsURL = (UserDefaults.standard.string(forKey: "emwaver.agent.backendURL") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        let raw = !envURL.isEmpty ? envURL : defaultsURL
        guard !raw.isEmpty, var base = URL(string: raw) else { return nil }

        // WebSocket endpoint.
        base.appendPathComponent("v1/ws")

        // Token: allow anon only in dev.
        let allowAnonSync = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")

        let tok: String
        if let session = auth.session, !session.idToken.isEmpty {
            tok = session.idToken
        } else if allowAnonSync {
            tok = ""
        } else {
            return nil
        }

        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)
        var q = comps?.queryItems ?? []
        if !tok.isEmpty {
            q.append(URLQueryItem(name: "token", value: tok))
        }
        // Helpful for debugging; backend still learns hostSessionId from hello.
        q.append(URLQueryItem(name: "hostSessionId", value: hostSessions.hostSessionId))
        comps?.queryItems = q

        guard let final = comps?.url else { return nil }

        // Convert http(s) -> ws(s)
        var wsComps = URLComponents(url: final, resolvingAgainstBaseURL: false)
        if wsComps?.scheme == "https" {
            wsComps?.scheme = "wss"
        } else if wsComps?.scheme == "http" {
            wsComps?.scheme = "ws"
        }
        guard let wsURL = wsComps?.url else { return nil }

        return (wsURL: wsURL, accessToken: tok)
    }

    private func reconnectLoop() async {
        while !Task.isCancelled {
            if socket == nil {
                await connectOnce()
            }
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    private func connectOnce() async {
        guard let cfg = backendConfig() else { return }
        guard let hostSessions else { return }

        let task = urlSession.webSocketTask(with: cfg.wsURL)
        socket = task
        task.resume()

        // Hello
        sendJson([
            "type": "hello",
            "role": "host",
            "protocolVersion": 1,
            "hostSessionId": hostSessions.hostSessionId,
        ])

        // Start receive loop.
        await receiveLoop()

        // If receive loop exits, close and retry.
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        isRemoteControlled = false
    }

    private func receiveLoop() async {
        while !Task.isCancelled, let socket {
            do {
                let msg = try await socket.receive()
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
            return

        case "script.run":
            guard let source = obj["source"] as? String else {
                sendJson(["type": "script.error", "error": "missing_source", "hostSessionId": hostSessions?.hostSessionId ?? ""]) 
                return
            }
            let name = (obj["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

            let instanceId = UUID().uuidString
            activeScriptInstanceId = instanceId
            uiRev = 0

            // Persist the currently remote-controlled script name for UX (best-effort).
            if let name, !name.isEmpty {
                UserDefaults.standard.set(name, forKey: "emwaver.remote.activeScriptName")
            } else {
                UserDefaults.standard.removeObject(forKey: "emwaver.remote.activeScriptName")
            }

            previewManager.render(script: source, name: name, moduleSources: [:])

            sendJson([
                "type": "script.started",
                "hostSessionId": hostSessions?.hostSessionId ?? "",
                "scriptInstanceId": instanceId,
                "name": name ?? "",
            ])

        case "ui.event":
            guard let scriptInstanceId = obj["scriptInstanceId"] as? String else { return }
            guard scriptInstanceId == activeScriptInstanceId else { return }
            guard let targetNodeId = obj["targetNodeId"] as? String else { return }
            guard let name = obj["name"] as? String else { return }
            let payload = obj["payload"] as? [String: Any] ?? [:]

            // Special-case plot viewport requests: the web controller does not hold the plot buffer,
            // so it asks the host to compute a compressed viewport and send back points.
            if name == "viewport" {
                if handlePlotViewportRequest(targetNodeId: targetNodeId, payload: payload) {
                    return
                }
            }

            dispatchUiEvent(targetNodeId: targetNodeId, name: name, payload: payload)

        default:
            return
        }
    }

    /// Invoke a handler token coming from a locally-rendered ScriptRenderView.
    ///
    /// This is used for the in-app “Remote Control” overlay so the host can
    /// interact with the remotely-running script UI while the web client is also
    /// attached.
    func invokeRemoteHandler(token: String, arguments: [Any]) {
        // Only allow invoking when a remote script is actually running.
        guard activeScriptInstanceId != nil else { return }
        previewManager.invoke(token: token, arguments: arguments)
    }

    private func dispatchUiEvent(targetNodeId: String, name: String, payload: [String: Any]) {
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
    private func handlePlotViewportRequest(targetNodeId: String, payload: [String: Any]) -> Bool {
        guard let scriptInstanceId = activeScriptInstanceId else { return false }
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
