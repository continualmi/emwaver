/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import os

@MainActor
public final class AgentChatViewModel: ObservableObject {
    private static let log = OSLog(subsystem: "com.emwaver", category: "AgentChat")
    private func dbg(_ msg: String) {
        os_log("%{public}@", log: Self.log, type: .debug, "[AgentChat] \(msg)")
    }

    public static let allowedModelIds: [String] = [
        "gpt-5.1-codex-max",
        "gpt-5.1-codex-mini",
        "gpt-5.1-codex",
        "gpt-5.2",
        "gpt-5.2-codex",
        "gpt-5.3-codex",
    ]

    public static let defaultModelId = "gpt-5.3-codex"

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
            conv.codexInputItemsJSON = []
            conv.sessionId = UUID().uuidString
            conv.modelId = Self.defaultModelId
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
            modelId: Self.defaultModelId,
            messages: [],
            codexInputItemsJSON: []
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

    public func setModelForSelectedConversation(_ modelId: String) {
        guard let id = selectedConversationId else { return }
        guard Self.allowedModelIds.contains(modelId) else { return }
        updateConversation(id: id) { conv in
            conv.modelId = modelId
            conv.updatedAt = Date()
        }
        persistState()
    }

    public var selectedModelId: String {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else { return Self.defaultModelId }
        return conv.modelId
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
            let userItem: [String: Any] = [
                "role": "user",
                "content": [["type": "input_text", "text": text]],
            ]
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.codexInputItemsJSON.append(jsonString(userItem))
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
        // Provide a light instruction prompt so Codex knows it is operating the host.
        let instructions = "You are an EMWaver agent running inside the macOS host app. Use tools to write .emw scripts, run them, inspect UI snapshots, and interact with the UI to complete tasks. Prefer using tools over guessing."

        let tools = toolSpecs()

        var iterations = 0
        var lastAssistantText = ""

        let sessionId = currentSessionId()

        while iterations < 10 {
            iterations += 1

            let inputItems = currentCodexInputItems()
            dbg("loop iter=\(iterations) model=\(selectedModelId) session=\(sessionId) input_items=\(inputItems.count)")

            let resp = try await codex.send(
                model: selectedModelId,
                instructions: instructions,
                input: inputItems,
                tools: tools,
                sessionId: sessionId
            )

            let outputItems = Self.extractResponsesOutputItems(resp)
            dbg("resp output_items=\(outputItems.count)")

            // First: persist the assistant output items into conversation state (so the next call has full context).
            // We also extract any visible assistant text.
            var functionCalls: [(callId: String, name: String, arguments: String)] = []
            var assistantTexts: [String] = []

            for item in outputItems {
                if let type = item["type"] as? String, type == "message" {
                    assistantTexts.append(Self.extractTextFromMessageItem(item))
                }

                if let type = item["type"] as? String, type == "function_call" {
                    let callId = (item["call_id"] as? String) ?? ""
                    let name = (item["name"] as? String) ?? ""
                    let args = (item["arguments"] as? String) ?? "{}"
                    if !callId.isEmpty, !name.isEmpty {
                        dbg("tool_call name=\(name) call_id=\(callId) args_len=\(args.count)")
                        functionCalls.append((callId: callId, name: name, arguments: args))
                    }
                }

                // Append every output item into our canonical input history.
                appendCodexItemToCurrentConversation(item)
            }

            let assistantText = assistantTexts.joined().trimmingCharacters(in: .whitespacesAndNewlines)
            if !assistantText.isEmpty {
                lastAssistantText = assistantText
            }

            if functionCalls.isEmpty {
                break
            }

            // Execute tools and append function_call_output items.
            for call in functionCalls {
                await MainActor.run {
                    self.messages.append(AgentChatMessage(role: .system, text: "[tool] \(call.name)"))
                }

                let argsObj = parseArgs(call.arguments)
                let result = try await executeTool(name: call.name, args: argsObj)
                dbg("tool_result name=\(call.name) call_id=\(call.callId) keys=\((result as NSDictionary).allKeys.count)")

                let outItem: [String: Any] = [
                    "type": "function_call_output",
                    "call_id": call.callId,
                    "output": jsonString(result),
                ]
                appendCodexItemToCurrentConversation(outItem)
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
            dbg("write_script name=\(name) bytes=\(source.utf8.count)")
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
            let snap = host.uiSnapshot()
            dbg("ui_snapshot keys=\((snap as NSDictionary).allKeys.count)")
            return snap

        case "list_scripts":
            // list local scripts (Documents/scripts)
            let ext = (args["extension"] as? String) // e.g. ".emw" or nil
            let files = try await host.fileService.listFiles(withExtension: ext, includeContent: false, accessToken: "")
            let items = files.map { f in
                [
                    "id": f.metadata.id,
                    "name": f.metadata.name,
                    "ext": f.metadata.fileExtension,
                    "size": f.metadata.sizeBytes,
                    "etag": f.metadata.etag,
                    "kind": f.metadata.kind,
                ] as [String: Any]
            }
            dbg("list_scripts ext=\(ext ?? "<any>") count=\(items.count)")
            return ["count": items.count, "items": items]

        case "list_signal_files":
            let ext = (args["extension"] as? String) // e.g. ".raw" or ".txt" or nil
            let files = try await host.fileService.listSignalFiles(withExtension: ext, includeContent: false, accessToken: "")
            let items = files.map { f in
                [
                    "id": f.metadata.id,
                    "name": f.metadata.name,
                    "ext": f.metadata.fileExtension,
                    "size": f.metadata.sizeBytes,
                    "etag": f.metadata.etag,
                    "kind": f.metadata.kind,
                ] as [String: Any]
            }
            dbg("list_signal_files ext=\(ext ?? "<any>") count=\(items.count)")
            return ["count": items.count, "items": items]

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
            .init(
                name: "list_scripts",
                description: "List local scripts in the host scripts folder.",
                parameters: [
                    "type": "object",
                    "properties": [
                        "extension": ["type": "string", "description": "Optional suffix filter like .emw"],
                    ],
                    "additionalProperties": false,
                ]
            ),
            .init(
                name: "list_signal_files",
                description: "List local signal files in the host signals folder.",
                parameters: [
                    "type": "object",
                    "properties": [
                        "extension": ["type": "string", "description": "Optional suffix filter like .raw or .txt"],
                    ],
                    "additionalProperties": false,
                ]
            ),
        ]
    }

    // MARK: - Responses helpers (aligned with anomalyco/opencode)

    private static func extractResponsesOutputItems(_ resp: [String: Any]) -> [[String: Any]] {
        guard let output = resp["output"] as? [Any] else { return [] }
        return output.compactMap { $0 as? [String: Any] }
    }

    private static func extractTextFromMessageItem(_ item: [String: Any]) -> String {
        guard let content = item["content"] as? [Any] else { return "" }
        var parts: [String] = []
        for cAny in content {
            guard let c = cAny as? [String: Any] else { continue }
            let type = (c["type"] as? String) ?? ""
            if type == "output_text" {
                if let t = c["text"] as? String, !t.isEmpty { parts.append(t) }
            } else if let t = c["text"] as? String, !t.isEmpty {
                // best-effort fallback
                parts.append(t)
            }
        }
        return parts.joined()
    }

    private func parseArgs(_ raw: Any?) -> [String: Any] {
        if let s = raw as? String {
            return parseArgs(s)
        }
        if let d = raw as? [String: Any] { return d }
        return [:]
    }

    private func parseArgs(_ raw: String) -> [String: Any] {
        if let data = raw.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return obj
        }
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
        var modelId: String
        var messages: [AgentChatMessage]

        // Host-local canonical prompt state for Codex Responses API.
        // Each entry is a JSON-encoded input item, e.g.
        // {"role":"user","content":[{"type":"input_text","text":"hi"}]}
        // {"type":"function_call","call_id":"...","name":"web_fetch","arguments":"{...}"}
        // {"type":"function_call_output","call_id":"...","output":"{...}"}
        var codexInputItemsJSON: [String]

        // Codable migration: tolerate older stored conversations.
        init(
            id: UUID,
            title: String?,
            createdAt: Date,
            updatedAt: Date,
            sessionId: String,
            modelId: String,
            messages: [AgentChatMessage],
            codexInputItemsJSON: [String]
        ) {
            self.id = id
            self.title = title
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.sessionId = sessionId
            self.modelId = modelId
            self.messages = messages
            self.codexInputItemsJSON = codexInputItemsJSON
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(UUID.self, forKey: .id)
            title = try c.decodeIfPresent(String.self, forKey: .title)
            createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
            updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
            sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? UUID().uuidString
            modelId = try c.decodeIfPresent(String.self, forKey: .modelId) ?? AgentChatViewModel.defaultModelId
            messages = try c.decodeIfPresent([AgentChatMessage].self, forKey: .messages) ?? []
            codexInputItemsJSON = try c.decodeIfPresent([String].self, forKey: .codexInputItemsJSON) ?? []
        }
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
                    modelId: Self.defaultModelId,
                    messages: msgs,
                    codexInputItemsJSON: []
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

    private func currentCodexInputItems() -> [[String: Any]] {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else { return [] }

        return conv.codexInputItemsJSON.compactMap { s in
            guard let data = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            return scrubItemReferences(obj)
        }
    }

    private func appendCodexItemToCurrentConversation(_ item: [String: Any]) {
        guard let scrubbed = scrubItemReferences(item) else { return }

        guard let id = selectedConversationId else { return }
        updateConversation(id: id) { conv in
            conv.codexInputItemsJSON.append(jsonString(scrubbed))
            conv.updatedAt = Date()
        }
        persistState()
    }

    /// Removes any Codex `item_reference` items that rely on server persistence.
    /// When `store=false`, these references will fail on the next request.
    private func scrubItemReferences(_ item: [String: Any]) -> [String: Any]? {
        if let t = item["type"] as? String, t == "item_reference" {
            return nil
        }

        // Some Codex outputs can embed item references in message content.
        if let t = item["type"] as? String, t == "message", var content = item["content"] as? [Any] {
            content = content.filter { partAny in
                guard let part = partAny as? [String: Any] else { return true }
                return (part["type"] as? String) != "item_reference"
            }
            var out = item
            out["content"] = content
            return out
        }

        return item
    }
}
