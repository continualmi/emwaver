/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import EMWaverScriptModel
import EMWaverScriptRuntime
import EMWaverScriptStorage

/// Host-side capabilities the agent can use. For macOS-first, the host is the app itself.
@MainActor
public protocol AgentHost: AnyObject {
    var fileService: FileService { get }
    var previewManager: ScriptPreviewManager { get }

    func runScript(name: String, source: String)
    func invokeUIEvent(targetNodeId: String, name: String, payload: [String: Any]) throws
    func uiSnapshot() -> [String: Any]
}

@MainActor
public final class DefaultAgentHost: AgentHost {
    public let fileService: FileService
    public let previewManager: ScriptPreviewManager

    public init(fileService: FileService = .shared, previewManager: ScriptPreviewManager) {
        self.fileService = fileService
        self.previewManager = previewManager
    }

    public func runScript(name: String, source: String) {
        previewManager.render(script: source, name: name, moduleSources: [:])
    }

    public func invokeUIEvent(targetNodeId: String, name: String, payload: [String: Any]) throws {
        guard let tree = previewManager.scriptTree else { return }
        guard let node = findNode(in: tree.root, id: targetNodeId) else { return }

        let eventType: ScriptEventType
        switch name.lowercased() {
        case "tap": eventType = .tap
        case "change": eventType = .change
        case "submit": eventType = .submit
        case "select": eventType = .select
        case "close": eventType = .close
        default:
            // Unknown event; ignore.
            return
        }

        guard let token = node.props.handlerId(for: eventType) else { return }

        // Payload-to-args mapping is intentionally minimal for now.
        // - tap/submit/close: []
        // - change/select: pass `value` if provided
        var args: [Any] = []
        if eventType == .change || eventType == .select {
            if let v = payload["value"] {
                args = [v]
            }
        }

        previewManager.invoke(token: token, arguments: args)
    }

    public func uiSnapshot() -> [String: Any] {
        guard let tree = previewManager.scriptTree else {
            return ["rev": 0, "root": NSNull()]
        }
        // No explicit rev tracking yet; expose a monotonic timestamp for polling.
        let rev = Int(Date().timeIntervalSince1970 * 1000)
        return [
            "rev": rev,
            "root": serializeNode(tree.root),
        ]
    }

    private func findNode(in node: ScriptNode, id: String) -> ScriptNode? {
        if node.id == id { return node }
        for c in node.children {
            if let found = findNode(in: c, id: id) {
                return found
            }
        }
        return nil
    }

    private func serializeNode(_ node: ScriptNode) -> [String: Any] {
        var props: [String: Any] = [:]

        // Common fields that help the agent.
        if let label = node.props.label { props["label"] = label }
        if let text = node.props.text { props["text"] = text }
        if let detail = node.props.progressDetail { props["detail"] = detail }

        // Expose raw value for controls when present.
        if let v = node.props.raw["value"] { props["value"] = v }
        if let min = node.props.raw["min"] { props["min"] = min }
        if let max = node.props.raw["max"] { props["max"] = max }

        // Expose event handler availability.
        let events = node.props.eventHandlers.keys.map { $0.rawValue }
        if !events.isEmpty { props["events"] = events }

        return [
            "id": node.id,
            "type": node.type.rawValue,
            "props": props,
            "children": node.children.map(serializeNode),
        ]
    }
}
