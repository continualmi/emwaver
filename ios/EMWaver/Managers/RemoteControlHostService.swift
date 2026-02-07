import Combine
import Foundation

import EMWaverScriptModel
import EMWaverScriptRuntime

@MainActor
final class RemoteControlHostService: ObservableObject {
    @Published private(set) var isRemoteControlled: Bool = false
    @Published private(set) var remoteScriptTree: ScriptTree?
    @Published private(set) var remoteActiveScriptName: String?

    private let urlSession: URLSession

    private weak var auth: AuthenticationManager?
    private weak var device: USBManager?
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

    func start(auth: AuthenticationManager, device: USBManager, hostSessions: HostSessionManager) {
        self.auth = auth
        self.device = device
        self.hostSessions = hostSessions

        previewManager.attach(device: device)

        treeCancellable?.cancel()
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
        isRemoteControlled = false
    }

    private func backendConfig() -> URL? {
        guard let auth else { return nil }
        guard let hostSessions else { return nil }

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
        q.append(URLQueryItem(name: "hostSessionId", value: hostSessions.hostSessionId))
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
        guard let wsURL = backendConfig() else { return }
        guard let hostSessions else { return }

        let task = urlSession.webSocketTask(with: wsURL)
        socket = task
        task.resume()

        sendJson([
            "type": "hello",
            "role": "host",
            "protocolVersion": 1,
            "hostSessionId": hostSessions.hostSessionId,
        ])

        await receiveLoop()

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
            isRemoteControlled = true
            return

        case "script.run":
            guard let source = obj["source"] as? String else { return }
            let name = (obj["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

            let instanceId = UUID().uuidString
            activeScriptInstanceId = instanceId
            uiRev = 0

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
            dispatchUiEvent(targetNodeId: targetNodeId, name: name, payload: payload)

        default:
            return
        }
    }

    /// Invoke a handler token coming from a locally-rendered ScriptRenderView.
    ///
    /// This is used for the in-app “Remote Control” overlay so the host can
    /// interact with the remotely-running script UI while the controller is attached.
    func invokeRemoteHandler(token: String, arguments: [Any]) {
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
        }

        previewManager.invoke(token: token, arguments: args)
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
