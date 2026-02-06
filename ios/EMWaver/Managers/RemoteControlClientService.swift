import Combine
import Foundation

import EMWaverScriptModel

@MainActor
final class RemoteControlClientService: ObservableObject {
    @Published private(set) var wsStatus: String = "disconnected"
    @Published private(set) var attachedHostSessionId: String?
    @Published private(set) var remoteScriptTree: ScriptTree?
    @Published private(set) var remoteActiveScriptName: String?
    @Published private(set) var remoteScriptInstanceId: String?
    @Published private(set) var uiRev: Int = 0
    @Published var lastError: String?

    private let urlSession: URLSession

    private weak var auth: AuthenticationManager?

    private var socket: URLSessionWebSocketTask?
    private var reconnectTask: Task<Void, Never>?

    private var targetHostSessionId: String?

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func start(auth: AuthenticationManager) {
        self.auth = auth
    }

    func stop() {
        reconnectTask?.cancel()
        reconnectTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        wsStatus = "disconnected"
        attachedHostSessionId = nil
        targetHostSessionId = nil
        remoteScriptTree = nil
        remoteActiveScriptName = nil
        remoteScriptInstanceId = nil
        uiRev = 0
    }

    func attach(to hostSessionId: String) {
        lastError = nil
        remoteScriptTree = nil
        remoteActiveScriptName = nil
        remoteScriptInstanceId = nil
        uiRev = 0

        targetHostSessionId = hostSessionId
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }
            await self.reconnectLoop()
        }
    }

    func runScript(name: String, source: String) {
        guard let hostId = attachedHostSessionId else { return }
        sendJson([
            "type": "script.run",
            "hostSessionId": hostId,
            "name": name,
            "source": source,
        ])
    }

    func sendUiEvent(targetNodeId: String, event: ScriptEventType, value: Any?) {
        guard let hostId = attachedHostSessionId else { return }
        guard let scriptInstanceId = remoteScriptInstanceId else { return }

        var payload: [String: Any] = [:]
        if let value, (event == .change || event == .select || event == .submit) {
            payload["value"] = value
        }

        sendJson([
            "type": "ui.event",
            "hostSessionId": hostId,
            "scriptInstanceId": scriptInstanceId,
            "baseRev": uiRev,
            "targetNodeId": targetNodeId,
            "name": event.rawValue,
            "payload": payload,
        ])
    }

    // MARK: - WebSocket

    private func backendWsUrl() -> URL? {
        guard let auth else { return nil }
        guard let base = CloudConfig.backendBaseURL() else { return nil }

        let allowAnonSync = CloudConfig.allowAnonSync()
        let tok: String
        if auth.isSignedIn, let session = auth.session, !session.idToken.isEmpty {
            tok = session.idToken
        } else if allowAnonSync {
            tok = ""
        } else {
            return nil
        }

        var wsBase = base
        wsBase.appendPathComponent("v1/ws")

        var comps = URLComponents(url: wsBase, resolvingAgainstBaseURL: false)
        var q = comps?.queryItems ?? []
        if !tok.isEmpty {
            q.append(URLQueryItem(name: "token", value: tok))
        }
        comps?.queryItems = q
        guard let final = comps?.url else { return nil }

        var wsComps = URLComponents(url: final, resolvingAgainstBaseURL: false)
        if wsComps?.scheme == "https" { wsComps?.scheme = "wss" }
        else if wsComps?.scheme == "http" { wsComps?.scheme = "ws" }
        return wsComps?.url
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
        guard let wsURL = backendWsUrl() else {
            lastError = "missing backend url or auth"
            return
        }
        guard let targetHostSessionId else { return }

        wsStatus = "connecting"

        let task = urlSession.webSocketTask(with: wsURL)
        socket = task
        task.resume()
        wsStatus = "open"

        sendJson([
            "type": "hello",
            "role": "web",
            "protocolVersion": 1,
        ])
        sendJson([
            "type": "host.attach",
            "hostSessionId": targetHostSessionId,
        ])

        await receiveLoop()

        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        wsStatus = "closed"
        attachedHostSessionId = nil
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
        case "host.attached":
            let hostId = (obj["hostSessionId"] as? String) ?? targetHostSessionId
            attachedHostSessionId = hostId

        case "host.error":
            lastError = "host error: \((obj["error"] as? String) ?? "error")"

        case "script.started":
            remoteScriptInstanceId = (obj["scriptInstanceId"] as? String)
            remoteActiveScriptName = (obj["name"] as? String)
            uiRev = 0

        case "ui.snapshot":
            if let rev = obj["rev"] as? NSNumber { uiRev = rev.intValue }
            if let root = obj["root"], let node = decodeNode(root) {
                let metadata = (obj["metadata"] as? [String: Any]) ?? [:]
                remoteScriptTree = ScriptTree(root: node, metadata: metadata)
            } else {
                remoteScriptTree = nil
            }

        case "script.error":
            lastError = "script error: \((obj["error"] as? String) ?? "error")"

        case "error":
            lastError = String(describing: obj["error"] ?? "error")

        default:
            break
        }
    }

    private func decodeNode(_ any: Any) -> ScriptNode? {
        guard let d = any as? [String: Any] else { return nil }
        let id = (d["id"] as? String) ?? ""
        let typeRaw = (d["type"] as? String) ?? "column"
        let type = ScriptNodeType(rawValue: typeRaw) ?? .column

        let propsRaw = (d["props"] as? [String: Any]) ?? [:]
        var handlers: [ScriptEventType: String] = [:]
        if let h = d["handlers"] as? [String: Any] {
            for (k, v) in h {
                guard let ev = ScriptEventType(rawValue: k) else { continue }
                if let s = v as? String { handlers[ev] = s }
            }
        }

        var children: [ScriptNode] = []
        if let kids = d["children"] as? [Any] {
            for it in kids {
                if let n = decodeNode(it) { children.append(n) }
            }
        }

        return ScriptNode(id: id, type: type, props: ScriptNodeProps(raw: propsRaw, eventHandlers: handlers), children: children)
    }

    private func sendJson(_ obj: [String: Any]) {
        guard let socket else { return }
        guard JSONSerialization.isValidJSONObject(obj) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        guard let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { _ in }
    }
}
