/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

@MainActor
public final class AgentChatViewModel: ObservableObject {
    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public private(set) var conversations: [ConversationInfo] = []
    @Published public private(set) var selectedConversationId: UUID?
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?

    public let host: AgentHost

    private let codex = AgentCodexClient()

    private let legacyDefaultsKey = "emwaver.agent.local.conversation"

    private let conversationsKey = "emwaver.agent.local.conversations.v1"
    private let selectedConversationKey = "emwaver.agent.local.selected_conversation_id"

    public init(host: AgentHost) {
        self.host = host
        loadPersistedState()
    }

    public var isChatGPTConnected: Bool {
        codex.isConnected()
    }

    public func clear() {
        messages.removeAll()
        lastError = nil

        guard let id = selectedConversationId else {
            persistState()
            return
        }
        updateConversation(id: id) { conv in
            conv.messages = []
            conv.sessionId = UUID().uuidString
            conv.updatedAt = Date()
        }
        persistState()
    }

    public func newConversation() {
        let id = UUID()
        let conv = Conversation(
            id: id,
            title: nil,
            createdAt: Date(),
            updatedAt: Date(),
            sessionId: UUID().uuidString,
            messages: []
        )
        upsertConversation(conv)
        selectConversation(id)
        persistState()
    }

    public func selectConversation(_ id: UUID) {
        selectedConversationId = id
        messages = conversation(id: id)?.messages ?? []
        persistState()
    }

    public func deleteConversation(_ id: UUID) {
        removeConversation(id)
        if selectedConversationId == id {
            if let next = conversations.first?.id {
                selectConversation(next)
            } else {
                selectedConversationId = nil
                messages = []
                newConversation()
            }
        }
        persistState()
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
        if let id = selectedConversationId {
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.updatedAt = Date()
            }
        }
        persistState()

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
                    if let id = self.selectedConversationId {
                        self.updateConversation(id: id) { conv in
                            conv.messages = self.messages
                            conv.updatedAt = Date()
                        }
                    }
                    self.persistState()
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

        let sessionId = currentSessionId()

        while iterations < 10 {
            iterations += 1

            let resp = try await codex.send(
                model: "gpt-5.3-codex",
                instructions: instructions,
                messages: msgs,
                tools: tools,
                sessionId: sessionId
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

    // MARK: - Local persistence (multiple conversations)

    public struct ConversationInfo: Identifiable, Equatable {
        public let id: UUID
        public let title: String
        public let updatedAt: Date
    }

    private struct Conversation: Identifiable, Codable, Equatable {
        let id: UUID
        var title: String?
        let createdAt: Date
        var updatedAt: Date
        var sessionId: String
        var messages: [AgentChatMessage]
    }

    private func conversation(id: UUID) -> Conversation? {
        loadAllConversations().first(where: { $0.id == id })
    }

    private func loadAllConversations() -> [Conversation] {
        guard let data = UserDefaults.standard.data(forKey: conversationsKey) else { return [] }
        let dec = JSONDecoder()
        return (try? dec.decode([Conversation].self, from: data)) ?? []
    }

    private func saveAllConversations(_ all: [Conversation]) {
        let enc = JSONEncoder()
        if let data = try? enc.encode(all) {
            UserDefaults.standard.set(data, forKey: conversationsKey)
        }
    }

    private func upsertConversation(_ conv: Conversation) {
        var all = loadAllConversations()
        if let idx = all.firstIndex(where: { $0.id == conv.id }) {
            all[idx] = conv
        } else {
            all.append(conv)
        }
        // Keep most-recent first.
        all.sort { $0.updatedAt > $1.updatedAt }
        saveAllConversations(all)
        refreshConversationInfos(from: all)
    }

    private func removeConversation(_ id: UUID) {
        var all = loadAllConversations()
        all.removeAll { $0.id == id }
        saveAllConversations(all)
        refreshConversationInfos(from: all)
    }

    private func updateConversation(id: UUID, mutate: (inout Conversation) -> Void) {
        var all = loadAllConversations()
        guard let idx = all.firstIndex(where: { $0.id == id }) else { return }
        var c = all[idx]
        mutate(&c)
        all[idx] = c
        all.sort { $0.updatedAt > $1.updatedAt }
        saveAllConversations(all)
        refreshConversationInfos(from: all)
    }

    private func refreshConversationInfos(from all: [Conversation]? = nil) {
        let all = all ?? loadAllConversations()
        conversations = all.map {
            ConversationInfo(
                id: $0.id,
                title: $0.title ?? "Chat",
                updatedAt: $0.updatedAt
            )
        }
    }

    private func persistState() {
        if let selectedConversationId {
            UserDefaults.standard.set(selectedConversationId.uuidString, forKey: selectedConversationKey)
        }

        // Messages are persisted as part of each conversation record.
        if let id = selectedConversationId {
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.updatedAt = Date()
            }
        }
    }

    private func loadPersistedState() {
        // Migrate legacy single-conversation storage if present.
        if let legacy = UserDefaults.standard.data(forKey: legacyDefaultsKey) {
            let dec = JSONDecoder()
            if let msgs = try? dec.decode([AgentChatMessage].self, from: legacy) {
                let id = UUID()
                let conv = Conversation(
                    id: id,
                    title: nil,
                    createdAt: Date(),
                    updatedAt: Date(),
                    sessionId: UUID().uuidString,
                    messages: msgs
                )
                upsertConversation(conv)
                UserDefaults.standard.removeObject(forKey: legacyDefaultsKey)
                selectedConversationId = id
                messages = msgs
            }
        }

        refreshConversationInfos()

        if let s = UserDefaults.standard.string(forKey: selectedConversationKey),
           let id = UUID(uuidString: s),
           conversation(id: id) != nil {
            selectedConversationId = id
            messages = conversation(id: id)?.messages ?? []
        } else if let first = conversations.first?.id {
            selectedConversationId = first
            messages = conversation(id: first)?.messages ?? []
        } else {
            newConversation()
        }
    }

    private func currentSessionId() -> String {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else {
            return UUID().uuidString
        }
        return conv.sessionId
    }
}
