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

    public enum ProviderId: String, Codable, CaseIterable {
        case chatgptCodex = "chatgpt_codex"
        case openrouter = "openrouter"
    }

    public static let allowedCodexModelIds: [String] = [
        "gpt-5.1-codex-max",
        "gpt-5.1-codex-mini",
        "gpt-5.1-codex",
        "gpt-5.2",
        "gpt-5.2-codex",
        "gpt-5.3-codex",
    ]

    public static let allowedOpenRouterModelIds: [String] = [
        "qwen/qwen3-coder-next",
        "x-ai/grok-4.1-fast",
    ]

    public static let defaultProviderId: ProviderId = .chatgptCodex
    public static let defaultModelId = "gpt-5.3-codex"

    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public private(set) var conversations: [ConversationInfo] = []
    @Published public private(set) var selectedConversationId: UUID?
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?

    private var assistantPlaceholderId: UUID?
    private var toolBubbleMessageIdByCallId: [String: UUID] = [:]

    public let host: AgentHost

    // Cloud persistence (optional): if provided, conversation list + messages are stored in the backend DB.
    // This enables cross-device continuity while still allowing local inference providers.
    private let cloudProvider: (() -> (baseURL: URL, accessToken: String)?)?

    private let codex = AgentCodexClient()
    private let openRouter = AgentOpenRouterClient()

    private let legacyDefaultsKey = "emwaver.agent.local.conversation"

    private let conversationsKey = "emwaver.agent.local.conversations.v1"
    private let selectedConversationKey = "emwaver.agent.local.selected_conversation_id"
    private let preferredModelKey = "emwaver.agent.local.preferred_model_id"
    private let preferredProviderKey = "emwaver.agent.local.preferred_provider_id"

    public init(host: AgentHost, cloudProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil) {
        self.host = host
        self.cloudProvider = cloudProvider

        // If cloud persistence is enabled, prefer cloud conversations over local state.
        if cloudProvider != nil {
            // Start with empty state; load from backend asynchronously.
            self.messages = []
            self.conversations = []
            self.selectedConversationId = nil
            Task { await self.refreshCloudConversations() }
        } else {
            loadPersistedState()
        }
    }

    private let keychainService = "com.emwaver.agent"
    private let openRouterKeyAccount = "openrouter_api_key"

    public var isChatGPTConnected: Bool {
        codex.isConnected()
    }

    public var isOpenRouterConnected: Bool {
        (try? KeychainStore.get(service: keychainService, account: openRouterKeyAccount)) != nil
    }

    public func setOpenRouterApiKey(_ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            try KeychainStore.set(service: keychainService, account: openRouterKeyAccount, data: Data(trimmed.utf8))
        } catch {
            lastError = error.localizedDescription
        }
    }

    public func disconnectOpenRouter() {
        do {
            try KeychainStore.delete(service: keychainService, account: openRouterKeyAccount)
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func getOpenRouterApiKey() throws -> String {
        guard let data = try KeychainStore.get(service: keychainService, account: openRouterKeyAccount) else {
            throw AgentBackendError.serverError("OpenRouter is not connected")
        }
        return String(data: data, encoding: .utf8) ?? ""
    }

    public func clear() {
        messages.removeAll()
        lastError = nil

        // In cloud mode, "clear" is intentionally a UI-only action for now.
        // (We can add a backend endpoint later if we want to delete messages.)
        if cloudProvider != nil {
            return
        }

        guard let id = selectedConversationId else {
            persistState()
            return
        }
        updateConversation(id: id) { conv in
            conv.messages = []
            conv.codexInputItemsJSON = []
            conv.openRouterMessagesJSON = []
            conv.sessionId = UUID().uuidString
            conv.modelId = Self.defaultModelId
            conv.providerId = Self.defaultProviderId
            conv.updatedAt = Date()
        }
        persistState()
    }

    public func newConversation() {
        if cloudProvider != nil {
            Task { await self.createCloudConversation() }
            return
        }

        let id = UUID()
        let conv = Conversation(
            id: id,
            title: nil,
            createdAt: Date(),
            updatedAt: Date(),
            sessionId: UUID().uuidString,
            providerId: preferredProviderId(),
            modelId: preferredModelId(),
            messages: [],
            codexInputItemsJSON: [],
            openRouterMessagesJSON: []
        )
        upsertConversation(conv)
        selectConversation(id)
        persistState()
    }

    public func selectConversation(_ id: UUID) {
        selectedConversationId = id

        if cloudProvider != nil {
            Task { await self.loadCloudMessages(conversationId: id) }
            return
        }

        messages = conversation(id: id)?.messages ?? []
        persistState()
    }

    public func setModelForSelectedConversation(_ modelId: String) {
        guard let id = selectedConversationId else { return }
        guard let conv = conversation(id: id) else { return }
        let allowed = allowedModels(for: conv.providerId)
        guard allowed.contains(modelId) else { return }
        UserDefaults.standard.set(modelId, forKey: preferredModelKey)
        updateConversation(id: id) { conv in
            conv.modelId = modelId
            conv.updatedAt = Date()
        }
        persistState()
        dbg("set model conv=\(id) provider=\(conv.providerId.rawValue) model=\(modelId)")
    }

    public var selectedProviderId: ProviderId {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else { return preferredProviderId() }
        return conv.providerId
    }

    public var selectedModelId: String {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else { return preferredModelId() }
        return conv.modelId
    }

    public var allowedModelsForSelectedProvider: [String] {
        allowedModels(for: selectedProviderId)
    }

    public func setProviderForSelectedConversation(_ provider: ProviderId) {
        guard let id = selectedConversationId else { return }
        UserDefaults.standard.set(provider.rawValue, forKey: preferredProviderKey)

        // If current model isn't valid for this provider, switch to provider default.
        let allowed = allowedModels(for: provider)
        let nextModel = allowed.contains(selectedModelId) ? selectedModelId : (allowed.first ?? Self.defaultModelId)

        updateConversation(id: id) { conv in
            conv.providerId = provider
            conv.modelId = nextModel
            conv.updatedAt = Date()
        }
        persistState()
        dbg("set provider conv=\(id) provider=\(provider.rawValue) model=\(nextModel)")
    }

    public func deleteConversation(_ id: UUID) {
        if cloudProvider != nil {
            Task { await self.deleteCloudConversation(id) }
            return
        }

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

        // In cloud mode we still run inference locally, but we persist user/assistant turns to the backend.
        let isCloud = (cloudProvider != nil)

        // Provider-specific connection checks
        switch selectedProviderId {
        case .chatgptCodex:
            guard isChatGPTConnected else {
                lastError = "Connect ChatGPT (Plus/Pro) first."
                return
            }
        case .openrouter:
            guard isOpenRouterConnected else {
                lastError = "Connect OpenRouter (API key) first."
                return
            }
        }

        messages.append(AgentChatMessage(role: .user, text: text))

        // Persist locally only in local mode.
        if !isCloud, let id = selectedConversationId {
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.updatedAt = Date()
                switch conv.providerId {
                case .chatgptCodex:
                    break
                case .openrouter:
                    let msg: [String: Any] = ["role": "user", "content": text]
                    conv.openRouterMessagesJSON.append(jsonString(msg))
                }
            }
            persistState()
        }

        isSending = true

        Task {
            do {
                // Ensure cloud conversation exists.
                if isCloud, self.selectedConversationId == nil {
                    await self.createCloudConversation()
                }

                // Persist user turn to cloud.
                if isCloud, let cid = self.selectedConversationId {
                    await self.appendCloudMessage(conversationId: cid, role: "user", content: text)
                }

                // Placeholder assistant message for streaming-ish UI.
                let placeholderId = UUID()
                await MainActor.run {
                    self.assistantPlaceholderId = placeholderId
                    self.messages.append(AgentChatMessage(id: placeholderId, role: .assistant, text: ""))
                }

                let reply: String
                switch self.selectedProviderId {
                case .chatgptCodex:
                    reply = try await self.runToolLoop(userPrompt: text)
                case .openrouter:
                    reply = try await self.runOpenRouterToolLoop(userPrompt: text)
                }

                // Persist assistant turn to cloud.
                if isCloud, let cid = self.selectedConversationId {
                    await self.appendCloudMessage(conversationId: cid, role: "assistant", content: reply)
                }

                await MainActor.run {
                    if let idx = self.messages.firstIndex(where: { $0.id == placeholderId }) {
                        self.messages[idx] = AgentChatMessage(id: placeholderId, role: .assistant, text: reply)
                    } else {
                        self.messages.append(AgentChatMessage(role: .assistant, text: reply))
                    }
                    self.isSending = false
                    self.assistantPlaceholderId = nil

                    // In cloud mode, refresh conversation list ordering.
                    if isCloud {
                        Task { await self.refreshCloudConversations() }
                    } else if let id = self.selectedConversationId {
                        self.updateConversation(id: id) { conv in
                            conv.messages = self.messages
                            conv.updatedAt = Date()
                        }
                        self.persistState()
                    }
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                }
            }
        }
    }

    // MARK: - Tool loop (Codex Responses)

    private func runToolLoop(userPrompt: String) async throws -> String {
        // Provide a light instruction prompt so Codex knows it is operating the host.
        let instructions = agentSystemPrompt() + "\n\n" + agentFormattingRules()

        let tools = toolSpecs()

        // Fast local answer for a common question: don't ask the model to enumerate its own tool schema.
        // This avoids formatting glitches and keeps the response consistent across providers.
        if Self.isToolListingPrompt(userPrompt) {
            return Self.localToolHelpMarkdown(tools)
        }

        var iterations = 0
        var lastAssistantText = ""

        let sessionId = currentSessionId()

        // Persist user message into Codex input history (opencode-style: replay full state, no server ids).
        appendCodexItemToCurrentConversation(Self.codexUserMessageItem(text: userPrompt))

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
                    let t = Self.extractTextFromMessageItem(item)
                    assistantTexts.append(t)
                    if !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        appendCodexItemToCurrentConversation(Self.codexAssistantMessageItem(text: t))
                    }
                }

                if let type = item["type"] as? String, type == "function_call" {
                    let callId = (item["call_id"] as? String) ?? ""
                    let name = (item["name"] as? String) ?? ""
                    let args = (item["arguments"] as? String) ?? "{}"
                    if !callId.isEmpty, !name.isEmpty {
                        dbg("tool_call name=\(name) call_id=\(callId) args_len=\(args.count)")
                        functionCalls.append((callId: callId, name: name, arguments: args))
                        appendCodexItemToCurrentConversation(Self.codexFunctionCallItem(callId: callId, name: name, arguments: args))
                    }
                }
            }

            let assistantText = assistantTexts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !assistantText.isEmpty {
                lastAssistantText = assistantText
            }

            if functionCalls.isEmpty {
                break
            }

            // Execute tools and append function_call_output items.
            for call in functionCalls {
                let argsObj = parseArgs(call.arguments)

                await MainActor.run {
                    self.appendSystemToolBubble(callId: call.callId, name: call.name, args: argsObj)
                }

                let result = try await executeTool(name: call.name, args: argsObj)
                dbg("tool_result name=\(call.name) call_id=\(call.callId) keys=\((result as NSDictionary).allKeys.count)")

                await MainActor.run {
                    self.updateSystemToolBubble(callId: call.callId, name: call.name, args: argsObj, result: result)
                }

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

    // MARK: - Tool loop (OpenRouter Chat Completions)

    private func agentSystemPrompt() -> String {
        // Source of truth lives in the repo at /AGENT_SYSTEM_PROMPT.md and is bundled into this SwiftPM
        // target as a resource (EMWaverScriptsUI/Resources/AGENT_SYSTEM_PROMPT.md).
        if let url = Bundle.module.url(forResource: "AGENT_SYSTEM_PROMPT", withExtension: "md"),
           let text = try? String(contentsOf: url, encoding: .utf8) {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Fallback: keep this minimal; prefer editing the bundled MD file.
        return "You are the EMWaver Agent."
    }

    private func agentFormattingRules() -> String {
        return "Formatting: respond in Markdown.\n- Use blank lines between paragraphs.\n- When listing items (tools, files, steps), use a Markdown bullet list with one item per line (prefix `- `).\n- When showing code, use fenced code blocks."
    }

    private func runOpenRouterToolLoop(userPrompt: String) async throws -> String {
        let instructions = agentSystemPrompt() + "\n\n" + agentFormattingRules()

        // Local tool listing
        if Self.isToolListingPrompt(userPrompt) {
            return Self.localToolHelpMarkdown(toolSpecs())
        }

        let apiKey = try getOpenRouterApiKey()
        let tools = toolSpecs().map { AgentOpenRouterClient.ToolSpec(name: $0.name, description: $0.description, parameters: $0.parameters) }

        // Ensure system message exists once per conversation.
        if let id = selectedConversationId {
            updateConversation(id: id) { conv in
                if conv.openRouterMessagesJSON.isEmpty {
                    let sys: [String: Any] = ["role": "system", "content": instructions]
                    conv.openRouterMessagesJSON.append(self.jsonString(sys))
                }
            }
            persistState()
        }

        var iterations = 0
        var lastAssistantText = ""

        while iterations < 10 {
            iterations += 1

            let history = currentOpenRouterMessages()
            dbg("openrouter loop iter=\(iterations) model=\(selectedModelId) msgs=\(history.count)")

            let assistantMsg = try await openRouter.sendStream(
                apiKey: apiKey,
                model: selectedModelId,
                messages: history,
                tools: tools
            )

            appendOpenRouterMessageToCurrentConversation(assistantMsg)

            let assistantText = (assistantMsg["content"] as? String) ?? ""
            if !assistantText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                lastAssistantText = assistantText
            }

            guard let toolCalls = assistantMsg["tool_calls"] as? [Any], !toolCalls.isEmpty else {
                break
            }

            for tcAny in toolCalls {
                guard let tc = tcAny as? [String: Any] else { continue }
                let callId = (tc["id"] as? String) ?? ""
                guard let fn = tc["function"] as? [String: Any] else { continue }
                let name = (fn["name"] as? String) ?? ""
                let argsStr = (fn["arguments"] as? String) ?? "{}"
                if name.isEmpty { continue }

                let argsObj = parseArgs(argsStr)

                await MainActor.run {
                    self.appendSystemToolBubble(callId: callId, name: name, args: argsObj)
                }

                let result = try await executeTool(name: name, args: argsObj)

                await MainActor.run {
                    self.updateSystemToolBubble(callId: callId, name: name, args: argsObj, result: result)
                }

                let toolMsg: [String: Any] = [
                    "role": "tool",
                    "tool_call_id": callId,
                    "content": jsonString(result),
                ]
                appendOpenRouterMessageToCurrentConversation(toolMsg)
            }
        }

        let trimmed = lastAssistantText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            throw AgentBackendError.serverError("OpenRouter produced no text")
        }
        return trimmed
    }

    private func makeToolBubbleText(name: String, args: [String: Any], fetchedURL: String? = nil) -> String {
        if name == "web_fetch" {
            // Show the URL directly in the tool bubble so users can audit what was fetched.
            let requested = (args["url"] as? String) ?? ""
            let urlToShow = (fetchedURL?.isEmpty == false) ? fetchedURL! : requested
            if urlToShow.isEmpty {
                return "[tool] \(name)"
            }
            return "[tool] \(name) \(urlToShow)"
        }
        return "[tool] \(name)"
    }

    private func appendSystemToolBubble(callId: String, name: String, args: [String: Any]) {
        let msg = AgentChatMessage(role: .system, text: makeToolBubbleText(name: name, args: args))

        // If we currently have an assistant placeholder message (empty bubble) at the end,
        // insert tool bubbles *before* it so the timeline reads naturally.
        if let pid = assistantPlaceholderId,
           let idx = messages.firstIndex(where: { $0.id == pid }) {
            messages.insert(msg, at: idx)
        } else {
            messages.append(msg)
        }

        if !callId.isEmpty {
            toolBubbleMessageIdByCallId[callId] = msg.id
        }

        // Keep the selected conversation's persisted messages in sync (so Xcode reloads match).
        if let id = selectedConversationId {
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.updatedAt = Date()
            }
        }
        persistState()
    }

    private func updateSystemToolBubble(callId: String, name: String, args: [String: Any], result: [String: Any]) {
        guard name == "web_fetch", !callId.isEmpty else { return }
        guard let mid = toolBubbleMessageIdByCallId[callId] else { return }

        let fetchedURL = (result["fetched_url"] as? String) ?? (result["url"] as? String)

        if let idx = messages.firstIndex(where: { $0.id == mid }) {
            let old = messages[idx]
            messages[idx] = AgentChatMessage(id: old.id, role: .system, text: makeToolBubbleText(name: name, args: args, fetchedURL: fetchedURL), createdAt: old.createdAt)
        }

        if let id = selectedConversationId {
            updateConversation(id: id) { conv in
                conv.messages = self.messages
                conv.updatedAt = Date()
            }
        }
        persistState()
    }

    private func executeTool(name: String, args: [String: Any]) async throws -> [String: Any] {
        switch name {
        case "web_fetch":
            let urlStr = (args["url"] as? String) ?? ""
            guard let url = URL(string: urlStr), !urlStr.isEmpty else { return ["error": "invalid_url"] }

            let (data, resp) = try await URLSession.shared.data(from: url)
            let fetchedUrlStr = resp.url?.absoluteString ?? urlStr

            let text = String(data: data, encoding: .utf8) ?? ""
            let clipped = String(text.prefix(40_000))
            return [
                "requested_url": urlStr,
                "fetched_url": fetchedUrlStr,
                "text": clipped,
            ]

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

        case "apply_patch":
            let patchText = (args["patchText"] as? String) ?? ""
            if patchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return ["error": "empty_patch"]
            }
            let baseDir = host.fileService.storageDirectoryURL()
            let result = try PatchApplier.apply(patchText: patchText, baseDir: baseDir)
            dbg("apply_patch files=\(result.files.count)")
            return [
                "ok": true,
                "files": result.files,
            ]

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
                description: "Write a .emw script into the EMWaver scripts folder (creates or overwrites a file).",
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
                name: "apply_patch",
                description: "Edit files using opencode-style patchText (*** Begin Patch / *** Update File / @@ hunks).",
                parameters: [
                    "type": "object",
                    "properties": [
                        "patchText": ["type": "string"],
                    ],
                    "required": ["patchText"],
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

    // MARK: - Local canned answers

    private static func isToolListingPrompt(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if t.contains("what tools") { return true }
        if t.contains("which tools") { return true }
        if t.contains("tools do you have") { return true }
        if t == "tools" { return true }
        return false
    }

    private static func localToolHelpMarkdown(_ tools: [AgentCodexClient.ToolSpec]) -> String {
        var out: [String] = []
        out.append("I can use the following tools:\n")
        out.append("") // blank line so Markdown list renders reliably
        for t in tools {
            out.append("- `\(t.name)` — \(t.description)")
        }
        return out.joined(separator: "\n")
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
        // Join blocks with a blank line to preserve paragraphs.
        return parts.joined(separator: "\n\n")
    }

    private static func codexUserMessageItem(text: String) -> [String: Any] {
        [
            "type": "message",
            "role": "user",
            "content": [
                ["type": "input_text", "text": text],
            ],
        ]
    }

    private static func codexAssistantMessageItem(text: String) -> [String: Any] {
        [
            "type": "message",
            "role": "assistant",
            "content": [
                ["type": "output_text", "text": text],
            ],
        ]
    }

    private static func codexFunctionCallItem(callId: String, name: String, arguments: String) -> [String: Any] {
        [
            "type": "function_call",
            "call_id": callId,
            "name": name,
            "arguments": arguments,
        ]
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
        var providerId: ProviderId
        var modelId: String
        var messages: [AgentChatMessage]

        // Host-local canonical prompt state for Codex Responses API.
        // Each entry is a JSON-encoded input item, e.g.
        // {"role":"user","content":[{"type":"input_text","text":"hi"}]}
        // {"type":"function_call","call_id":"...","name":"web_fetch","arguments":"{...}"}
        // {"type":"function_call_output","call_id":"...","output":"{...}"}
        var codexInputItemsJSON: [String]

        // Host-local canonical prompt state for OpenRouter Chat Completions.
        // Each entry is a JSON-encoded chat message dict (role/content, plus tool_calls/tool_call_id).
        var openRouterMessagesJSON: [String]

        // Codable migration: tolerate older stored conversations.
        init(
            id: UUID,
            title: String?,
            createdAt: Date,
            updatedAt: Date,
            sessionId: String,
            providerId: ProviderId,
            modelId: String,
            messages: [AgentChatMessage],
            codexInputItemsJSON: [String],
            openRouterMessagesJSON: [String]
        ) {
            self.id = id
            self.title = title
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.sessionId = sessionId
            self.providerId = providerId
            self.modelId = modelId
            self.messages = messages
            self.codexInputItemsJSON = codexInputItemsJSON
            self.openRouterMessagesJSON = openRouterMessagesJSON
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(UUID.self, forKey: .id)
            title = try c.decodeIfPresent(String.self, forKey: .title)
            createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
            updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
            sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId) ?? UUID().uuidString
            providerId = try c.decodeIfPresent(ProviderId.self, forKey: .providerId) ?? AgentChatViewModel.defaultProviderId
            modelId = try c.decodeIfPresent(String.self, forKey: .modelId) ?? AgentChatViewModel.defaultModelId
            messages = try c.decodeIfPresent([AgentChatMessage].self, forKey: .messages) ?? []
            codexInputItemsJSON = try c.decodeIfPresent([String].self, forKey: .codexInputItemsJSON) ?? []
            openRouterMessagesJSON = try c.decodeIfPresent([String].self, forKey: .openRouterMessagesJSON) ?? []
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

    private func allowedModels(for provider: ProviderId) -> [String] {
        switch provider {
        case .chatgptCodex: return Self.allowedCodexModelIds
        case .openrouter: return Self.allowedOpenRouterModelIds
        }
    }

    private func preferredProviderId() -> ProviderId {
        let raw = UserDefaults.standard.string(forKey: preferredProviderKey)
        return ProviderId(rawValue: raw ?? "") ?? Self.defaultProviderId
    }

    private func preferredModelId() -> String {
        let provider = preferredProviderId()
        let allowed = allowedModels(for: provider)
        let fallback = allowed.first ?? Self.defaultModelId
        let m = UserDefaults.standard.string(forKey: preferredModelKey) ?? fallback
        return allowed.contains(m) ? m : fallback
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
                    providerId: Self.defaultProviderId,
                    modelId: Self.defaultModelId,
                    messages: msgs,
                    codexInputItemsJSON: [],
                    openRouterMessagesJSON: []
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
                  let objAny = try? JSONSerialization.jsonObject(with: data) else { return nil }
            guard let scrubbedAny = scrubItemReferencesDeep(objAny) else { return nil }
            return scrubbedAny as? [String: Any]
        }
    }

    private func currentOpenRouterMessages() -> [[String: Any]] {
        guard let id = selectedConversationId,
              let conv = conversation(id: id) else { return [] }

        return conv.openRouterMessagesJSON.compactMap { s in
            guard let data = s.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            return obj
        }
    }

    private func appendCodexItemToCurrentConversation(_ item: [String: Any]) {
        guard let scrubbedAny = scrubItemReferencesDeep(item) else { return }
        guard let scrubbed = scrubbedAny as? [String: Any] else { return }

        guard let id = selectedConversationId else { return }
        updateConversation(id: id) { conv in
            conv.codexInputItemsJSON.append(jsonString(scrubbed))
            conv.updatedAt = Date()
        }
        persistState()
    }

    private func appendOpenRouterMessageToCurrentConversation(_ msg: [String: Any]) {
        guard let id = selectedConversationId else { return }
        updateConversation(id: id) { conv in
            conv.openRouterMessagesJSON.append(jsonString(msg))
            conv.updatedAt = Date()
        }
        persistState()
    }

    /// Removes any Codex `item_reference` objects (even nested) that rely on server persistence.
    /// When `store=false`, these references will fail on the next request.
    private func scrubItemReferencesDeep(_ any: Any) -> Any? {
        if let dict = any as? [String: Any] {
            if (dict["type"] as? String) == "item_reference" {
                return nil
            }
            var out: [String: Any] = [:]
            out.reserveCapacity(dict.count)
            for (k, v) in dict {
                // When store=false, server-side item IDs are not stable/persisted.
                // Never replay them back; they can trigger "Item with id rs_... not found" errors.
                if k == "id" || k == "response_id" {
                    continue
                }
                if let scrubbed = scrubItemReferencesDeep(v) {
                    out[k] = scrubbed
                }
            }
            return out
        }

        if let arr = any as? [Any] {
            return arr.compactMap { scrubItemReferencesDeep($0) }
        }

        // Scalars
        return any
    }
}

// MARK: - apply_patch (opencode-style)

private enum PatchApplier {
    struct ApplyResult {
        let files: [[String: Any]]
    }

    enum PatchError: LocalizedError {
        case invalidPatch(String)
        case invalidPath(String)
        case fileNotFound(String)
        case hunkFailed(String)

        var errorDescription: String? {
            switch self {
            case .invalidPatch(let s): return s
            case .invalidPath(let s): return s
            case .fileNotFound(let s): return s
            case .hunkFailed(let s): return s
            }
        }
    }

    static func apply(patchText: String, baseDir: URL) throws -> ApplyResult {
        let normalized = patchText.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        guard lines.first?.trimmingCharacters(in: .whitespacesAndNewlines) == "*** Begin Patch" else {
            throw PatchError.invalidPatch("apply_patch: missing *** Begin Patch")
        }
        guard lines.last?.trimmingCharacters(in: .whitespacesAndNewlines) == "*** End Patch" else {
            throw PatchError.invalidPatch("apply_patch: missing *** End Patch")
        }

        var i = 1
        var results: [[String: Any]] = []

        func safeRelativePath(_ raw: String) throws -> String {
            let p = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if p.isEmpty { throw PatchError.invalidPath("empty path") }
            if p.hasPrefix("/") { throw PatchError.invalidPath("absolute paths not allowed: \(p)") }
            if p.contains("..") { throw PatchError.invalidPath("parent traversal not allowed: \(p)") }
            return p
        }

        while i < lines.count - 1 {
            let line = lines[i]
            if line.hasPrefix("*** Add File: ") {
                let rel = try safeRelativePath(String(line.dropFirst("*** Add File: ".count)))
                i += 1
                var newLines: [String] = []
                while i < lines.count - 1, !lines[i].hasPrefix("*** ") {
                    let l = lines[i]
                    guard l.hasPrefix("+") else {
                        throw PatchError.invalidPatch("Add File contents must be prefixed with +")
                    }
                    newLines.append(String(l.dropFirst(1)))
                    i += 1
                }
                let url = baseDir.appendingPathComponent(rel)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                let out = newLines.joined(separator: "\n") + "\n"
                try out.write(to: url, atomically: true, encoding: .utf8)
                results.append(["path": rel, "op": "add", "bytes": out.utf8.count])
                continue
            }

            if line.hasPrefix("*** Delete File: ") {
                let rel = try safeRelativePath(String(line.dropFirst("*** Delete File: ".count)))
                let url = baseDir.appendingPathComponent(rel)
                guard FileManager.default.fileExists(atPath: url.path) else {
                    throw PatchError.fileNotFound(rel)
                }
                try FileManager.default.removeItem(at: url)
                results.append(["path": rel, "op": "delete"]) 
                i += 1
                continue
            }

            if line.hasPrefix("*** Update File: ") {
                let rel = try safeRelativePath(String(line.dropFirst("*** Update File: ".count)))
                i += 1

                var moveTo: String?
                if i < lines.count - 1, lines[i].hasPrefix("*** Move to: ") {
                    moveTo = try safeRelativePath(String(lines[i].dropFirst("*** Move to: ".count)))
                    i += 1
                }

                let srcURL = baseDir.appendingPathComponent(rel)
                guard FileManager.default.fileExists(atPath: srcURL.path) else {
                    throw PatchError.fileNotFound(rel)
                }

                let oldText = (try? String(contentsOf: srcURL, encoding: .utf8)) ?? ""
                var fileLines = oldText.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

                // Parse hunks until next *** header.
                while i < lines.count - 1, !lines[i].hasPrefix("*** ") {
                    let h = lines[i]
                    guard h.hasPrefix("@@") else {
                        throw PatchError.invalidPatch("Update File expected @@ hunk header, got: \(h)")
                    }
                    // @@ -oldStart,oldCount +newStart,newCount @@
                    let nums = parseUnifiedHeader(h)
                    i += 1
                    var hunkLines: [String] = []
                    while i < lines.count - 1, !lines[i].hasPrefix("@@") && !lines[i].hasPrefix("*** ") {
                        hunkLines.append(lines[i])
                        i += 1
                    }
                    fileLines = try applyHunk(fileLines: fileLines, oldStart1: nums.oldStart, hunkLines: hunkLines, filePath: rel)
                }

                let newText = fileLines.joined(separator: "\n") + "\n"

                let destRel = moveTo ?? rel
                let destURL = baseDir.appendingPathComponent(destRel)
                try FileManager.default.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try newText.write(to: destURL, atomically: true, encoding: .utf8)

                if let moveTo {
                    try FileManager.default.removeItem(at: srcURL)
                    results.append(["path": rel, "op": "move", "to": moveTo])
                } else {
                    results.append(["path": rel, "op": "update", "bytes": newText.utf8.count])
                }
                continue
            }

            // Skip blanks between sections
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                i += 1
                continue
            }

            throw PatchError.invalidPatch("Unknown patch directive: \(line)")
        }

        return ApplyResult(files: results)
    }

    private struct UnifiedHeaderNums {
        let oldStart: Int
    }

    private static func parseUnifiedHeader(_ header: String) -> UnifiedHeaderNums {
        // very small parser; if it fails, just fall back to 1
        // format: @@ -a,b +c,d @@
        let parts = header.split(separator: " ")
        for p in parts {
            if p.hasPrefix("-") {
                let nums = p.dropFirst().split(separator: ",")
                if let a = Int(nums.first ?? "") {
                    return UnifiedHeaderNums(oldStart: a)
                }
            }
        }
        return UnifiedHeaderNums(oldStart: 1)
    }

    private static func applyHunk(fileLines: [String], oldStart1: Int, hunkLines: [String], filePath: String) throws -> [String] {
        var out = fileLines
        let startIdx = max(0, oldStart1 - 1)

        func matches(at idx: Int) -> Bool {
            var fi = idx
            for hl in hunkLines {
                if hl.hasPrefix("+") { continue }
                guard fi < out.count else { return false }
                let expected = String(hl.dropFirst(1))
                let prefix = hl.prefix(1)
                if prefix == " " || prefix == "-" {
                    if out[fi] != expected { return false }
                    fi += 1
                }
            }
            return true
        }

        var applyAt: Int? = nil
        if startIdx <= out.count, matches(at: startIdx) {
            applyAt = startIdx
        } else {
            // fallback search
            for idx in 0...max(0, out.count) {
                if matches(at: idx) {
                    applyAt = idx
                    break
                }
            }
        }

        guard let idx0 = applyAt else {
            throw PatchError.hunkFailed("Failed to apply hunk to \(filePath)")
        }

        var fi = idx0
        var newBlock: [String] = []
        var consumed = 0

        for hl in hunkLines {
            guard let first = hl.first else { continue }
            let rest = String(hl.dropFirst(1))
            switch first {
            case " ":
                newBlock.append(rest)
                fi += 1
                consumed += 1
            case "-":
                fi += 1
                consumed += 1
            case "+":
                newBlock.append(rest)
            default:
                throw PatchError.invalidPatch("Invalid hunk line: \(hl)")
            }
        }

        out.replaceSubrange(idx0..<(idx0 + consumed), with: newBlock)
        return out
    }
}


extension AgentChatViewModel {
    func refreshCloudConversations() async {
        guard let provider = cloudProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            return
        }

        do {
            let api = AgentCloudAPI()
            let rows = try await api.listConversations(baseURL: ctx.baseURL, token: ctx.accessToken)

            let infos: [ConversationInfo] = rows.compactMap { r in
                guard let id = UUID(uuidString: r.id) else { return nil }
                return ConversationInfo(
                    id: id,
                    title: r.title ?? "Chat",
                    updatedAt: Date(timeIntervalSince1970: TimeInterval(r.updated_at_ms) / 1000.0)
                )
            }

            self.conversations = infos

            // Auto-select first conversation if none selected.
            if self.selectedConversationId == nil {
                if let first = infos.first?.id {
                    self.selectConversation(first)
                } else {
                    // Create an initial conversation.
                    await self.createCloudConversation()
                }
            }

        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func createCloudConversation() async {
        guard let provider = cloudProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            self.lastError = "Sign in to use the Agent."
            return
        }

        do {
            let api = AgentCloudAPI()
            let c = try await api.createConversation(baseURL: ctx.baseURL, token: ctx.accessToken, title: nil)
            guard let id = UUID(uuidString: c.id) else {
                throw NSError(domain: "AgentCloud", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid conversation id"]) 
            }

            await refreshCloudConversations()
            selectConversation(id)
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func loadCloudMessages(conversationId: UUID) async {
        guard let provider = cloudProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            self.lastError = "Sign in to use the Agent."
            return
        }

        let cid = conversationId.uuidString.lowercased()

        do {
            let api = AgentCloudAPI()
            let rows = try await api.listMessages(baseURL: ctx.baseURL, token: ctx.accessToken, conversationId: cid)

            self.messages = rows.compactMap { r in
                let mid = UUID(uuidString: r.id) ?? UUID()
                let role: AgentChatMessage.Role
                switch r.role {
                case "assistant": role = .assistant
                case "system": role = .system
                default: role = .user
                }
                return AgentChatMessage(id: mid, role: role, text: r.content)
            }

            // Ensure we have a shadow local conversation for provider state.
            ensureShadowLocalConversationExists(id: conversationId)

            // Rebuild provider histories from plain messages so the next send has context.
            rebuildLocalHistoriesFromDisplayedMessages()
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func deleteCloudConversation(_ id: UUID) async {
        guard let provider = cloudProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            self.lastError = "Sign in to use the Agent."
            return
        }

        do {
            let api = AgentCloudAPI()
            try await api.deleteConversation(baseURL: ctx.baseURL, token: ctx.accessToken, conversationId: id.uuidString.lowercased())

            if self.selectedConversationId == id {
                self.selectedConversationId = nil
                self.messages = []
            }

            await refreshCloudConversations()
        } catch {
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func appendCloudMessage(conversationId: UUID, role: String, content: String) async {
        guard let provider = cloudProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            return
        }

        do {
            let api = AgentCloudAPI()
            _ = try await api.appendMessage(
                baseURL: ctx.baseURL,
                token: ctx.accessToken,
                conversationId: conversationId.uuidString.lowercased(),
                role: role,
                content: content
            )
        } catch {
            // Best-effort; keep UI responsive even if persistence fails.
            self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func ensureShadowLocalConversationExists(id: UUID) {
        // Create a local shadow conversation if missing. This stores provider/model/session state
        // (Codex input items / OpenRouter messages) so local inference can reuse cloud history.
        if conversation(id: id) != nil { return }

        let conv = Conversation(
            id: id,
            title: nil,
            createdAt: Date(),
            updatedAt: Date(),
            sessionId: UUID().uuidString,
            providerId: preferredProviderId(),
            modelId: preferredModelId(),
            messages: [],
            codexInputItemsJSON: [],
            openRouterMessagesJSON: []
        )
        upsertConversation(conv)
    }

    private func rebuildLocalHistoriesFromDisplayedMessages() {
        // Reset provider histories so local inference reuses cloud history.
        guard let id = selectedConversationId else { return }

        updateConversation(id: id) { conv in
            conv.codexInputItemsJSON = []
            conv.openRouterMessagesJSON = []
            conv.sessionId = UUID().uuidString
        }

        // Seed OpenRouter with system instructions, then replay user/assistant turns.
        let instructions = agentSystemPrompt() + "\n\n" + agentFormattingRules()
        updateConversation(id: id) { conv in
            let sys: [String: Any] = ["role": "system", "content": instructions]
            conv.openRouterMessagesJSON.append(self.jsonString(sys))
        }

        for m in messages {
            switch m.role {
            case .user:
                appendOpenRouterMessageToCurrentConversation(["role": "user", "content": m.text])
                appendCodexItemToCurrentConversation(Self.codexUserMessageItem(text: m.text))
            case .assistant:
                appendOpenRouterMessageToCurrentConversation(["role": "assistant", "content": m.text])
                appendCodexItemToCurrentConversation(Self.codexAssistantMessageItem(text: m.text))
            case .system:
                // Skip tool bubbles/system notices for now.
                break
            }
        }

        persistState()
    }
}
