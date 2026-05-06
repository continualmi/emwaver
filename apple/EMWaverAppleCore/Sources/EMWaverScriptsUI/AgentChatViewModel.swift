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
    private static let storedPromptName = "emwaver-prompt"
    private static let universeDefaultsKey = "emwaver.agent.mgptUniverse"

    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public private(set) var conversations: [ConversationInfo] = []
    @Published public private(set) var selectedConversationId: UUID?
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?

    private var assistantPlaceholderId: UUID?
    private var selectedUniverseId: String?
    private var toolRuntime: AgentToolRuntime?

    // Endpoint context for API-key Agent execution. The tuple names are kept
    // for source compatibility with existing app callers.
    private let endpointProvider: (() -> (baseURL: URL, accessToken: String)?)?

    public init(endpointProvider: (() -> (baseURL: URL, accessToken: String)?)? = nil) {
        self.endpointProvider = endpointProvider
        self.messages = []
        let storedUniverse = UserDefaults.standard.string(forKey: Self.universeDefaultsKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        self.selectedUniverseId = storedUniverse?.isEmpty == false ? storedUniverse : nil
        if let selectedUniverseId = self.selectedUniverseId, let id = UUID(uuidString: selectedUniverseId) {
            self.conversations = [ConversationInfo(id: id, title: "Chat", updatedAt: Date())]
            self.selectedConversationId = id
        } else {
            self.conversations = []
            self.selectedConversationId = nil
        }
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
        messages = []
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
        if selectedConversationId == id {
            selectedConversationId = conversations.first?.id
            messages = []
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

    private func sendAgent(userText text: String) {
        guard endpointProvider != nil else {
            lastError = "Add a Continual API key to enable Agent replies."
            return
        }

        appendMessage(AgentChatMessage(role: .user, text: text))

        isSending = true

        Task {
            do {
                if self.selectedConversationId == nil {
                    await MainActor.run {
                        self.startLocalConversation()
                    }
                }

                // Placeholder assistant message while the managed Agent runs.
                let placeholderId = UUID()
                await MainActor.run {
                    self.assistantPlaceholderId = placeholderId
                    self.appendMessage(AgentChatMessage(id: placeholderId, role: .assistant, text: ""))
                }

                let reply = try await self.runAgentEndpointRequest(userPrompt: text, placeholderId: placeholderId)
                await MainActor.run {
                    self.replaceMessage(
                        id: placeholderId,
                        with: AgentChatMessage(id: placeholderId, role: .assistant, text: reply)
                    )
                    self.isSending = false
                    self.assistantPlaceholderId = nil
                    self.touchSelectedConversation()
                }
            } catch {
                await MainActor.run {
                    let fallback = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    if self.lastError?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                        self.lastError = fallback
                    }
                    self.isSending = false
                    self.assistantPlaceholderId = nil
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

        let response = try await api.send(
            endpoint: ctx.baseURL,
            apiKey: ctx.accessToken,
            request: AgentEndpointRequest(
                model: "mdl-1-lite-frozen",
                universe: universe,
                userInput: toolAugmentedPrompt(userPrompt)
            )
        )

        let requestedToolCalls = response.toolCalls?.isEmpty == false
            ? response.toolCalls
            : extractToolCalls(from: response)

        if let toolCalls = requestedToolCalls, !toolCalls.isEmpty, let toolRuntime {
            let toolResults = await executeToolCalls(toolCalls, runtime: toolRuntime)
            let toolResultPrompt = encodeToolResultPrompt(toolResults)
            let followup = try await api.send(
                endpoint: ctx.baseURL,
                apiKey: ctx.accessToken,
                request: AgentEndpointRequest(
                    model: "mdl-1-lite-frozen",
                    universe: universe,
                    userInput: toolResultPrompt
                )
            )
            return try await renderResponse(followup, placeholderId: placeholderId)
        }

        return try await renderResponse(response, placeholderId: placeholderId)
    }

    private func renderResponse(_ response: AgentEndpointResponse, placeholderId: UUID) async throws -> String {

        let pieces = [
            response.message,
            response.assistantRaw,
            response.code.map { "```emw\n\($0)\n```" },
            response.patch.map { "Patch:\n\($0)" },
            response.warnings?.isEmpty == false ? "Warnings:\n" + (response.warnings ?? []).map { "- \($0)" }.joined(separator: "\n") : nil,
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let reply = pieces.joined(separator: "\n\n")
        await MainActor.run {
            self.replaceMessage(
                id: placeholderId,
                with: AgentChatMessage(id: placeholderId, role: .assistant, text: reply)
            )
        }
        guard !reply.isEmpty else {
            throw AgentEndpointError.serverError("Agent model produced no text")
        }
        return reply
    }

    private func toolAugmentedPrompt(_ userPrompt: String) -> String {
        guard let toolRuntime else { return userPrompt }
        let manifest = toolRuntime.manifest().trimmingCharacters(in: .whitespacesAndNewlines)
        let context = toolRuntime.context().trimmingCharacters(in: .whitespacesAndNewlines)
        return """
        \(userPrompt)

        EMWaver local macOS tool context:
        \(context)

        Available local tools:
        \(manifest)

        If you need local state or need to perform an action, respond with JSON containing a top-level toolCalls array. Each tool call must have name and arguments. After tool results are returned, produce the final user-facing answer.
        """
    }

    private func executeToolCalls(_ toolCalls: [AgentToolCall], runtime: AgentToolRuntime) async -> [AgentToolResult] {
        var results: [AgentToolResult] = []
        for call in toolCalls.prefix(10) {
            appendSystemToolBubble(name: call.name, args: toolBubbleArgs(call.arguments ?? [:]))
            let result = await runtime.execute(call.name, call.arguments ?? [:])
            results.append(result)
        }
        return results
    }

    private func toolBubbleArgs(_ arguments: [String: AgentToolJSON]) -> [String: Any] {
        var args: [String: Any] = [:]
        if let detail = arguments["scriptId"]?.stringValue ?? arguments["event"]?.stringValue {
            args["detail"] = detail
        }
        return args
    }

    private func encodeToolResultPrompt(_ results: [AgentToolResult]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = (try? encoder.encode(results)) ?? Data()
        let json = String(data: data, encoding: .utf8) ?? "[]"
        return """
        EMWaver local tool results:
        ```json
        \(json)
        ```

        Use these results to answer the user's original request. Do not request the same tool again unless the result says it failed because more specific arguments are needed.
        """
    }

    private struct EmbeddedToolCallEnvelope: Decodable {
        let toolCalls: [AgentToolCall]
    }

    private func extractToolCalls(from response: AgentEndpointResponse) -> [AgentToolCall]? {
        for text in [response.message, response.assistantRaw].compactMap({ $0 }) {
            if let calls = decodeToolCalls(from: text), !calls.isEmpty {
                return calls
            }
        }
        return nil
    }

    private func decodeToolCalls(from text: String) -> [AgentToolCall]? {
        let candidates = jsonCandidates(in: text)
        for candidate in candidates {
            guard let data = candidate.data(using: .utf8) else { continue }
            if let envelope = try? JSONDecoder().decode(EmbeddedToolCallEnvelope.self, from: data) {
                return envelope.toolCalls
            }
            if let calls = try? JSONDecoder().decode([AgentToolCall].self, from: data) {
                return calls
            }
        }
        return nil
    }

    private func jsonCandidates(in text: String) -> [String] {
        var candidates = [text.trimmingCharacters(in: .whitespacesAndNewlines)]
        let pattern = #"```(?:json)?\s*([\s\S]*?)```"#
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            let range = NSRange(text.startIndex..<text.endIndex, in: text)
            for match in regex.matches(in: text, options: [], range: range) {
                guard match.numberOfRanges > 1,
                      let swiftRange = Range(match.range(at: 1), in: text) else {
                    continue
                }
                candidates.append(String(text[swiftRange]).trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return candidates
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
            UserDefaults.standard.set(universe, forKey: Self.universeDefaultsKey)
            if let id = UUID(uuidString: universe) {
                self.selectedConversationId = id
                if !self.conversations.contains(where: { $0.id == id }) {
                    self.conversations = [ConversationInfo(id: id, title: self.defaultConversationTitle, updatedAt: Date())] + self.conversations
                }
            }
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

    private func appendSystemToolBubble(name: String, args: [String: Any]) {
        let msg = AgentChatMessage(role: .system, text: makeToolBubbleText(name: name, args: args))

        // If we currently have an assistant placeholder message (empty bubble) at the end,
        // insert tool bubbles *before* it so the timeline reads naturally.
        if let pid = assistantPlaceholderId,
           let idx = messages.firstIndex(where: { $0.id == pid }) {
            var updated = messages
            updated.insert(msg, at: idx)
            messages = updated
        } else {
            appendMessage(msg)
        }
    }

    private func appendMessage(_ message: AgentChatMessage) {
        messages = messages + [message]
    }

    private func replaceMessage(id: UUID, with message: AgentChatMessage) {
        guard let idx = messages.firstIndex(where: { $0.id == id }) else { return }
        var updated = messages
        updated[idx] = message
        messages = updated
    }

    public struct ConversationInfo: Identifiable, Equatable {
        public let id: UUID
        public let title: String
        public let updatedAt: Date
    }

    private var defaultConversationTitle: String {
        "Chat"
    }

    private func startLocalConversation() {
        let id = UUID()
        selectedUniverseId = nil
        UserDefaults.standard.removeObject(forKey: Self.universeDefaultsKey)
        let info = ConversationInfo(id: id, title: defaultConversationTitle, updatedAt: Date())
        conversations = [info] + conversations
        selectedConversationId = id
        messages = []
    }

    private func touchSelectedConversation() {
        guard let selectedConversationId else { return }
        let now = Date()
        conversations = conversations.map { info in
            info.id == selectedConversationId
                ? ConversationInfo(id: info.id, title: info.title, updatedAt: now)
                : info
        }
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
