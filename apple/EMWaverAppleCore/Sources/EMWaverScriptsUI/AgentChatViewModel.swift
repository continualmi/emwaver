/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

@MainActor
public final class AgentChatViewModel: ObservableObject {
    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?

    public let host: AgentHost

    private let codex = AgentCodexClient()

    private let defaultsKey = "emwaver.agent.local.conversation"

    public init(host: AgentHost) {
        self.host = host
        loadPersistedConversation()
    }

    public var isChatGPTConnected: Bool {
        codex.isConnected()
    }

    public func clear() {
        messages.removeAll()
        lastError = nil
        persistConversation()
    }

    public func newConversation() {
        clear()
    }

    public func connectChatGPTViaBrowser() {
        lastError = nil
        Task {
            do {
                try await codex.connectViaBrowserOAuth()
                await MainActor.run {
                    self.lastError = nil
                    self.objectWillChange.send()
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    public func disconnectChatGPT() {
        codex.disconnect()
        objectWillChange.send()
    }

    public func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isSending else { return }

        lastError = nil
        draft = ""

        guard isChatGPTConnected else {
            lastError = "Connect ChatGPT (Plus/Pro) first."
            return
        }

        messages.append(AgentChatMessage(role: .user, text: text))
        persistConversation()

        isSending = true

        Task {
            do {
                // Placeholder assistant message for streaming-ish UI.
                let placeholderId = UUID()
                await MainActor.run {
                    self.messages.append(AgentChatMessage(id: placeholderId, role: .assistant, text: ""))
                }

                let reply = try await runToolLoop(userPrompt: text)

                await MainActor.run {
                    if let idx = self.messages.firstIndex(where: { $0.id == placeholderId }) {
                        self.messages[idx] = AgentChatMessage(id: placeholderId, role: .assistant, text: reply)
                    } else {
                        self.messages.append(AgentChatMessage(role: .assistant, text: reply))
                    }
                    self.isSending = false
                    self.persistConversation()
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.isSending = false
                }
            }
        }
    }

    // MARK: - Tool loop

    private func runToolLoop(userPrompt: String) async throws -> String {
        // Convert our chat messages into OpenAI-compatible messages.
        var msgs: [[String: Any]] = messages.map { m in
            [
                "role": m.role.rawValue,
                "content": m.text,
            ]
        }

        // Provide a light instruction prompt so Codex knows it is operating the host.
        let instructions = "You are an EMWaver agent running inside the macOS host app. Use tools to write .emw scripts, run them, inspect UI snapshots, and interact with the UI to complete tasks. Prefer using tools over guessing."

        let tools = toolSpecs()

        var iterations = 0
        var lastAssistantText = ""

        while iterations < 10 {
            iterations += 1

            let resp = try await codex.send(
                model: "gpt-5.3-codex",
                instructions: instructions,
                messages: msgs,
                tools: tools,
                maxOutputTokens: 1200,
                temperature: 0.2
            )

            let parsed = Self.parseCodexResponse(resp)
            if !parsed.text.isEmpty {
                lastAssistantText = parsed.text
            }

            if parsed.toolCalls.isEmpty {
                break
            }

            // Add assistant message with tool calls (for context).
            msgs.append([
                "role": "assistant",
                "content": parsed.text,
                "tool_calls": parsed.toolCalls,
            ])

            for tc in parsed.toolCalls {
                guard let callId = tc["id"] as? String else { continue }
                let fn = tc["function"] as? [String: Any]
                let name = fn?["name"] as? String ?? ""
                let argsRaw = fn?["arguments"]
                let argsJson: [String: Any] = parseArgs(argsRaw)

                // Emit a visible system line.
                await MainActor.run {
                    self.messages.append(AgentChatMessage(role: .system, text: "[tool] \(name)"))
                }

                let result = try await executeTool(name: name, args: argsJson)

                msgs.append([
                    "role": "tool",
                    "tool_call_id": callId,
                    "content": jsonString(result),
                ])
            }
        }

        let trimmed = lastAssistantText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw AgentBackendError.serverError("Codex produced no text")
        }
        return trimmed
    }

    private func executeTool(name: String, args: [String: Any]) async throws -> [String: Any] {
        switch name {
        case "web_fetch":
            let urlStr = (args["url"] as? String) ?? ""
            guard let url = URL(string: urlStr), !urlStr.isEmpty else { return ["error": "invalid_url"] }
            let (data, _) = try await URLSession.shared.data(from: url)
            let text = String(data: data, encoding: .utf8) ?? ""
            let clipped = String(text.prefix(40_000))
            return ["url": urlStr, "text": clipped]

        case "write_script":
            let name = (args["name"] as? String) ?? "script.emw"
            let source = (args["source"] as? String) ?? ""
            if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return ["error": "empty_source"]
            }
            let dir = host.fileService.storageDirectoryURL()
            let fileURL = dir.appendingPathComponent(name)
            try Data(source.utf8).write(to: fileURL, options: .atomic)
            return ["ok": true, "path": fileURL.lastPathComponent]

        case "run_script":
            let name = (args["name"] as? String) ?? "agent_run.emw"
            let source = (args["source"] as? String) ?? ""
            if source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return ["error": "empty_source"]
            }
            host.runScript(name: name, source: source)
            return ["ok": true]

        case "ui_snapshot":
            return host.uiSnapshot()

        case "ui_event":
            let nodeId = (args["targetNodeId"] as? String) ?? ""
            let ev = (args["name"] as? String) ?? "tap"
            let payload = (args["payload"] as? [String: Any]) ?? [:]
            try host.invokeUIEvent(targetNodeId: nodeId, name: ev, payload: payload)
            return ["ok": true]

        default:
            return ["error": "unknown_tool"]
        }
    }

    private func toolSpecs() -> [AgentCodexClient.ToolSpec] {
        return [
            .init(
                name: "web_fetch",
                description: "Fetch a URL and return its text content (best-effort).",
                parameters: [
                    "type": "object",
                    "properties": ["url": ["type": "string"]],
                    "required": ["url"],
                    "additionalProperties": false,
                ]
            ),
            .init(
                name: "write_script",
                description: "Write a .emw script into the EMWaver scripts folder.",
                parameters: [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "source": ["type": "string"],
                    ],
                    "required": ["name", "source"],
                    "additionalProperties": false,
                ]
            ),
            .init(
                name: "run_script",
                description: "Run a script in the host app, rendering its UI.",
                parameters: [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string"],
                        "source": ["type": "string"],
                    ],
                    "required": ["name", "source"],
                    "additionalProperties": false,
                ]
            ),
            .init(
                name: "ui_snapshot",
                description: "Get the current rendered Script UI tree snapshot.",
                parameters: [
                    "type": "object",
                    "properties": [:],
                    "additionalProperties": false,
                ]
            ),
            .init(
                name: "ui_event",
                description: "Send a semantic UI event to a target node id.",
                parameters: [
                    "type": "object",
                    "properties": [
                        "targetNodeId": ["type": "string"],
                        "name": ["type": "string", "description": "tap|change|submit|select|close"],
                        "payload": ["type": "object"],
                    ],
                    "required": ["targetNodeId", "name"],
                    "additionalProperties": false,
                ]
            ),
        ]
    }

    private struct ParsedCodex {
        let text: String
        let toolCalls: [[String: Any]] // chat.completions-style tool_calls objects
    }

    private static func parseCodexResponse(_ resp: [String: Any]) -> ParsedCodex {
        // Compatibility 1: chat.completions-like response.
        if let choices = resp["choices"] as? [Any],
           let choice0 = choices.first as? [String: Any],
           let msg = choice0["message"] as? [String: Any] {
            let text = (msg["content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let toolCalls = msg["tool_calls"] as? [[String: Any]] ?? []
            return ParsedCodex(text: text, toolCalls: toolCalls)
        }

        // Compatibility 2: Responses API shape.
        // Try `output_text` first.
        if let outText = resp["output_text"] as? String {
            return ParsedCodex(text: outText.trimmingCharacters(in: .whitespacesAndNewlines), toolCalls: extractToolCallsFromResponses(resp))
        }

        // Otherwise traverse `output`.
        let text = extractTextFromResponses(resp)
        let toolCalls = extractToolCallsFromResponses(resp)
        return ParsedCodex(text: text, toolCalls: toolCalls)
    }

    private static func extractTextFromResponses(_ resp: [String: Any]) -> String {
        guard let output = resp["output"] as? [Any] else { return "" }
        var parts: [String] = []
        for itemAny in output {
            guard let item = itemAny as? [String: Any] else { continue }
            if let type = item["type"] as? String, type == "message" {
                if let content = item["content"] as? [Any] {
                    for cAny in content {
                        guard let c = cAny as? [String: Any] else { continue }
                        if let text = c["text"] as? String, !text.isEmpty {
                            parts.append(text)
                        }
                    }
                }
            }
        }
        return parts.joined().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractToolCallsFromResponses(_ resp: [String: Any]) -> [[String: Any]] {
        guard let output = resp["output"] as? [Any] else { return [] }
        var out: [[String: Any]] = []
        for itemAny in output {
            guard let item = itemAny as? [String: Any] else { continue }
            let type = (item["type"] as? String) ?? ""

            // Some variants emit tool calls as top-level items.
            if type == "tool_call" || type == "function_call" {
                let id = (item["id"] as? String) ?? UUID().uuidString
                let name = (item["name"] as? String) ?? (item["tool_name"] as? String) ?? ""
                let args = item["arguments"] ?? item["input"] ?? "{}"
                out.append([
                    "id": id,
                    "type": "function",
                    "function": [
                        "name": name,
                        "arguments": args,
                    ],
                ])
                continue
            }

            // Or nested under message content.
            if type == "message", let content = item["content"] as? [Any] {
                for cAny in content {
                    guard let c = cAny as? [String: Any] else { continue }
                    let ctype = (c["type"] as? String) ?? ""
                    if ctype == "tool_call" || ctype == "function_call" {
                        let id = (c["id"] as? String) ?? UUID().uuidString
                        let name = (c["name"] as? String) ?? ""
                        let args = c["arguments"] ?? c["input"] ?? "{}"
                        out.append([
                            "id": id,
                            "type": "function",
                            "function": [
                                "name": name,
                                "arguments": args,
                            ],
                        ])
                    }
                }
            }
        }
        return out
    }

    private func parseArgs(_ raw: Any?) -> [String: Any] {
        if let s = raw as? String {
            if let data = s.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return obj
            }
            return [:]
        }
        if let d = raw as? [String: Any] { return d }
        return [:]
    }

    private func jsonString(_ obj: Any) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    // MARK: - Local persistence

    private func persistConversation() {
        let enc = JSONEncoder()
        if let data = try? enc.encode(messages) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }

    private func loadPersistedConversation() {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey) else { return }
        let dec = JSONDecoder()
        if let decoded = try? dec.decode([AgentChatMessage].self, from: data) {
            messages = decoded
        }
    }
}
