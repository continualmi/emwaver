/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import os

@MainActor
public final class AgentChatViewModel: ObservableObject {
    private static let log = OSLog(subsystem: "com.emwaver", category: "AgentChat")

    public static let defaultModelId = "managed-by-server"
    private static let publicModelAlias = "emw-1-lite-frozen"
    private static let storedPromptName = "emwaver-prompt"
    private static let localPrompt: String? = {
        guard let url = Bundle.module.url(forResource: "emwaver-prompt", withExtension: "txt"),
              let text = try? String(contentsOf: url, encoding: .utf8),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }()
    private static let selectedConversationDefaultsKey = "emwaver.agent.selectedConversation"
    private static let legacyUniverseDefaultsKey = "emwaver.agent.mgptUniverse"

    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public private(set) var conversations: [ConversationInfo] = []
    @Published public private(set) var selectedConversationId: UUID?
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public private(set) var isLoadingConversation: Bool = false
    @Published public var lastError: String?

    private var assistantPlaceholderId: UUID?
    private var selectedUniverseId: String?
    private var toolRuntime: AgentToolRuntime?
    private var activeRunTask: Task<Void, Never>?
    private let chatStore: AgentChatStore

    // Endpoint context for API-key Agent execution. The tuple names are kept
    // for source compatibility with existing app callers.
    private let endpointProvider: (() -> (baseURL: URL, accessToken: String)?)?

    public convenience init(endpointProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil) {
        self.init(endpointProvider: endpointProvider, chatStore: .shared)
    }

    init(endpointProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil, chatStore: AgentChatStore) {
        self.endpointProvider = endpointProvider
        self.chatStore = chatStore
        self.messages = []
        loadStoredConversations()
    }

    public var isAgentConfigured: Bool {
        guard let provider = endpointProvider, let ctx = provider() else { return false }
        return !ctx.baseURL.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !ctx.accessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var selectedModelId: String {
        Self.defaultModelId
    }

    public func configureToolRuntime(_ runtime: AgentToolRuntime?) {
        toolRuntime = runtime
    }

    public func clear() {
        messages.removeAll()
        lastError = nil
    }

    public func newConversation() {
        guard endpointProvider != nil else {
            lastError = "Add a Continual API key to enable Agent replies."
            return
        }
        startLocalConversation()
    }

    public func selectConversation(_ id: UUID) {
        selectedConversationId = id
        UserDefaults.standard.set(id.uuidString, forKey: Self.selectedConversationDefaultsKey)
        let selected = conversations.first { $0.id == id }
        selectedUniverseId = selected?.universeId
        loadMessagesForSelectedConversation(id)
    }

    public func setModelForSelectedConversation(_ modelId: String) {
        _ = modelId
        // Model selection is server-managed.
    }

    public func deleteConversation(_ id: UUID) {
        guard endpointProvider != nil else {
            lastError = "Add a Continual API key to enable Agent replies."
            return
        }
        conversations.removeAll { $0.id == id }
        try? chatStore.archiveConversation(id)
        if selectedConversationId == id {
            startLocalConversation()
        }
    }

    public func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isSending else { return }

        lastError = nil
        draft = ""

        sendAgent(userText: text)
    }

    public func stop() {
        activeRunTask?.cancel()
        activeRunTask = nil
        isSending = false
        assistantPlaceholderId = nil
    }

    private func sendAgent(userText text: String) {
        guard endpointProvider != nil else {
            lastError = "Add a Continual API key to enable Agent replies."
            return
        }

        if selectedConversationId == nil {
            startLocalConversation()
        }
        appendMessage(AgentChatMessage(role: .user, text: text))

        isSending = true

        activeRunTask = Task {
            do {
                let placeholderId = UUID()
                let reply = try await self.runAgentEndpointRequest(userPrompt: text, placeholderId: placeholderId)
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    self.appendMessage(AgentChatMessage(id: placeholderId, role: .assistant, text: reply))
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                    self.activeRunTask = nil
                    self.touchSelectedConversation()
                }
            } catch is CancellationError {
                await MainActor.run {
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                    self.activeRunTask = nil
                }
            } catch let urlError as URLError where urlError.code == .cancelled {
                await MainActor.run {
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                    self.activeRunTask = nil
                }
            } catch {
                await MainActor.run {
                    let fallback = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    if self.lastError?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                        self.lastError = fallback
                    }
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                    self.activeRunTask = nil
                }
            }
        }
    }

    // MARK: - API-key Agent endpoint

    private func runAgentEndpointRequest(userPrompt: String, placeholderId: UUID) async throws -> String {
        guard let provider = endpointProvider, let ctx = provider(), !ctx.accessToken.isEmpty else {
            throw AgentEndpointError.serverError("Add a Continual API key to enable Agent replies.")
        }
        let api = AgentEndpointAPI()
        let universe = try await ensureUniverseId(api: api, endpoint: ctx.baseURL, apiKey: ctx.accessToken)
        let tools = toolRuntime?.tools()

        let response = try await api.send(
            endpoint: ctx.baseURL,
            apiKey: ctx.accessToken,
            request: AgentEndpointRequest(
                model: Self.publicModelAlias,
                universe: universe,
                userInput: toolPrompt(userPrompt),
                tools: tools,
                toolChoice: tools?.isEmpty == false ? .auto : nil,
                systemPromptOverride: Self.localPrompt
            )
        )

        var currentResponse = response
        var accumulatedToolResults: [AgentToolResult] = []
        while let toolCalls = currentResponse.toolCalls, !toolCalls.isEmpty {
            try Task.checkCancellation()
            guard let toolRuntime else {
                throw AgentEndpointError.serverError("Agent requested a tool, but local tools are not available.")
            }

            let toolResults = await executeToolCalls(toolCalls, runtime: toolRuntime)
            accumulatedToolResults.append(contentsOf: toolResults)
            try Task.checkCancellation()
            currentResponse = try await api.send(
                endpoint: ctx.baseURL,
                apiKey: ctx.accessToken,
                request: AgentEndpointRequest(
                    model: Self.publicModelAlias,
                    universe: universe,
                    userInput: toolPrompt(userPrompt),
                    tools: tools,
                    toolChoice: .auto,
                    toolResults: accumulatedToolResults,
                    systemPromptOverride: Self.localPrompt
                )
            )
        }

        return try await renderResponse(currentResponse, placeholderId: placeholderId)
    }

    private func renderResponse(_ response: AgentEndpointResponse, placeholderId: UUID) async throws -> String {
        _ = placeholderId

        let pieces = [
            response.message,
            response.assistantRaw,
            response.code.map { "```emw\n\($0)\n```" },
            response.patch.map { "Patch:\n\($0)" },
            response.warnings?.isEmpty == false ? "Warnings:\n" + (response.warnings ?? []).map { "- \($0)" }.joined(separator: "\n") : nil,
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let reply = pieces.joined(separator: "\n\n")
        guard !reply.isEmpty else {
            throw AgentEndpointError.serverError("Agent model produced no text")
        }
        return reply
    }

    private func toolPrompt(_ userPrompt: String) -> String {
        guard let toolRuntime else { return userPrompt }
        let context = toolRuntime.context().trimmingCharacters(in: .whitespacesAndNewlines)
        return """
        \(userPrompt)

        EMWaver local macOS tool context:
        \(context)
        """
    }

    private func executeToolCalls(_ toolCalls: [AgentToolCall], runtime: AgentToolRuntime) async -> [AgentToolResult] {
        var results: [AgentToolResult] = []
        for call in toolCalls.prefix(10) {
            let bubbleId = appendSystemToolBubble(name: call.name, args: toolBubbleArgs(call.arguments ?? [:]), callArguments: call.arguments)
            let result = await runtime.execute(call.name, call.arguments ?? [:])
            updateToolBubble(id: bubbleId, result: result)
            results.append(
                AgentToolResult(
                    id: call.id ?? result.id,
                    callId: call.callId ?? call.id ?? result.callId,
                    name: call.name,
                    arguments: call.arguments,
                    output: result.output ?? .object([
                        "ok": .bool(result.ok),
                        "result": result.result ?? .null,
                        "error": result.error.map { .string($0) } ?? .null,
                    ]),
                    ok: result.ok,
                    result: result.result,
                    error: result.error
                )
            )
        }
        return results
    }

    private func toolBubbleArgs(_ arguments: [String: AgentToolJSON]) -> [String: Any] {
        var args: [String: Any] = [:]
        if let detail = arguments["scriptId"]?.stringValue {
            args["detail"] = detail
        } else if case .number(let pin) = arguments["pin"] {
            args["detail"] = "pin \(Int(pin))"
        } else if case .number(let cs) = arguments["cs"] {
            args["detail"] = "cs \(Int(cs))"
        }
        return args
    }

    private func ensureUniverseId(api: AgentEndpointAPI, endpoint: URL, apiKey: String) async throws -> String {
        if let selectedUniverseId, !selectedUniverseId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return selectedUniverseId
        }

        let created = try await api.createUniverse(
            endpoint: endpoint,
            apiKey: apiKey,
            storedPrompt: Self.storedPromptName,
            displayName: "EMWaver Agent"
        )
        let universe = created.universe.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !universe.isEmpty else {
            throw AgentEndpointError.invalidResponse
        }
        await MainActor.run {
            self.selectedUniverseId = universe
            let id = self.selectedConversationId ?? UUID()
            self.selectedConversationId = id
            UserDefaults.standard.set(id.uuidString, forKey: Self.selectedConversationDefaultsKey)
            if let index = self.conversations.firstIndex(where: { $0.id == id }) {
                self.conversations[index] = ConversationInfo(id: id, universeId: universe, title: self.conversations[index].title, createdAt: self.conversations[index].createdAt, updatedAt: Date())
            } else {
                self.conversations = [ConversationInfo(id: id, universeId: universe, title: self.defaultConversationTitle, updatedAt: Date())] + self.conversations
            }
            self.persistConversation(id: id)
        }
        return universe
    }

    private func makeToolBubbleText(name: String, args: [String: Any], fetchedURL: String? = nil) -> String {
        if let detail = args["detail"] as? String, !detail.isEmpty {
            return "[tool] \(name) \(detail)"
        }
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

    @discardableResult
    private func appendSystemToolBubble(name: String, args: [String: Any], callArguments: [String: AgentToolJSON]? = nil) -> UUID {
        let msg = AgentChatMessage(role: .system, text: makeToolBubbleText(name: name, args: args), toolMeta: AgentChatToolMeta(arguments: callArguments))

        // If we currently have an assistant placeholder message (empty bubble) at the end,
        // insert tool bubbles *before* it so the timeline reads naturally.
        if let pid = assistantPlaceholderId,
           let idx = messages.firstIndex(where: { $0.id == pid }) {
            var updated = messages
            updated.insert(msg, at: idx)
            messages = updated
            persistMessage(msg)
        } else {
            appendMessage(msg)
        }
        return msg.id
    }

    private func updateToolBubble(id: UUID, result: AgentToolResult) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        let old = messages[idx]
        let output: AgentToolJSON? = result.output
            ?? (result.ok ? result.result : result.error.map { .string($0) })
        let updated = AgentChatMessage(
            id: old.id, role: old.role, text: old.text, createdAt: old.createdAt,
            toolMeta: AgentChatToolMeta(arguments: old.toolMeta?.arguments, output: output, ok: result.ok)
        )
        replaceMessage(id: id, with: updated)
    }

    private func appendMessage(_ message: AgentChatMessage) {
        messages = messages + [message]
        persistMessage(message)
    }

    private func replaceMessage(id: UUID, with message: AgentChatMessage) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        var updated = messages
        updated[idx] = message
        messages = updated
        persistMessage(message)
    }

    public struct ConversationInfo: Identifiable, Equatable {
        public let id: UUID
        public let universeId: String?
        public let title: String
        public let createdAt: Date
        public let updatedAt: Date

        public init(id: UUID, universeId: String?, title: String, createdAt: Date = Date(), updatedAt: Date) {
            self.id = id
            self.universeId = universeId
            self.title = title
            self.createdAt = createdAt
            self.updatedAt = updatedAt
        }
    }

    private var defaultConversationTitle: String {
        "Chat"
    }

    private func startLocalConversation() {
        let id = UUID()
        selectedUniverseId = nil
        UserDefaults.standard.set(id.uuidString, forKey: Self.selectedConversationDefaultsKey)
        let info = ConversationInfo(id: id, universeId: nil, title: defaultConversationTitle, updatedAt: Date())
        conversations = [info] + conversations
        selectedConversationId = id
        isLoadingConversation = false
        messages = []
        persistConversation(id: id)
    }

    private func touchSelectedConversation() {
        guard let selectedConversationId else { return }
        let now = Date()
        conversations = conversations.map { info in
            info.id == selectedConversationId
                ? ConversationInfo(id: info.id, universeId: info.universeId, title: info.title, createdAt: info.createdAt, updatedAt: now)
                : info
        }
        persistConversation(id: selectedConversationId)
    }

    private func loadStoredConversations() {
        let stored = (try? chatStore.conversations()) ?? []
        conversations = stored.map {
            ConversationInfo(id: $0.id, universeId: $0.universeId, title: $0.title, createdAt: $0.createdAt, updatedAt: $0.updatedAt)
        }

        if conversations.isEmpty,
           let legacyUniverse = UserDefaults.standard.string(forKey: Self.legacyUniverseDefaultsKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !legacyUniverse.isEmpty {
            let id = UUID()
            let info = ConversationInfo(id: id, universeId: legacyUniverse, title: defaultConversationTitle, updatedAt: Date())
            conversations = [info]
            selectedConversationId = id
            selectedUniverseId = legacyUniverse
            messages = []
            persistConversation(id: id)
            UserDefaults.standard.set(id.uuidString, forKey: Self.selectedConversationDefaultsKey)
            UserDefaults.standard.removeObject(forKey: Self.legacyUniverseDefaultsKey)
            return
        }

        let selectedId = UserDefaults.standard.string(forKey: Self.selectedConversationDefaultsKey)
            .flatMap(UUID.init(uuidString:))
        let selected = conversations.first(where: { $0.id == selectedId }) ?? conversations.first
        selectedConversationId = selected?.id
        selectedUniverseId = selected?.universeId
        if let selected {
            UserDefaults.standard.set(selected.id.uuidString, forKey: Self.selectedConversationDefaultsKey)
            messages = loadMessages(conversationId: selected.id)
        }
    }

    private func loadMessagesForSelectedConversation(_ id: UUID) {
        isLoadingConversation = true
        messages = []

        DispatchQueue.main.async {
            guard self.selectedConversationId == id else { return }
            self.messages = self.loadMessages(conversationId: id)
            self.isLoadingConversation = false
        }
    }

    private func loadMessages(conversationId: UUID) -> [AgentChatMessage] {
        (try? chatStore.messages(conversationId: conversationId)) ?? []
    }

    private func persistConversation(id: UUID) {
        guard let info = conversations.first(where: { $0.id == id }) else { return }
        try? chatStore.upsertConversation(
            StoredAgentConversation(
                id: info.id,
                universeId: info.universeId,
                title: info.title,
                createdAt: info.createdAt,
                updatedAt: info.updatedAt
            )
        )
    }

    private func persistMessage(_ message: AgentChatMessage) {
        guard let selectedConversationId else { return }
        try? chatStore.upsertMessage(message, conversationId: selectedConversationId)
    }
}

// MARK: - apply_patch (opencode-style)

enum PatchApplier {
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
