/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Combine
import Foundation
import SwiftUI

@MainActor
public final class AgentChatViewModel: ObservableObject {
    @Published public private(set) var messages: [AgentChatMessage] = []
    @Published public var draft: String = ""
    @Published public var isSending: Bool = false
    @Published public var lastError: String?
    @Published public private(set) var conversations: [AgentConversationDTO] = []

    // Backend config is provided by the host app (usually the same config used for cloud sync).
    public typealias ConfigProvider = () -> (baseURL: URL, accessToken: String)?

    private let api: AgentBackendAPI
    private var configProvider: ConfigProvider?

    private let conversationIdDefaultsKey = "emwaver.agent.conversationId"

    private var conversationId: String? {
        get {
            let raw = (UserDefaults.standard.string(forKey: conversationIdDefaultsKey) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return raw.isEmpty ? nil : raw
        }
        set {
            if let v = newValue, !v.isEmpty {
                UserDefaults.standard.set(v, forKey: conversationIdDefaultsKey)
            } else {
                UserDefaults.standard.removeObject(forKey: conversationIdDefaultsKey)
            }
        }
    }

    public init(configProvider: ConfigProvider? = nil, urlSession: URLSession = .shared) {
        self.api = AgentBackendAPI(urlSession: urlSession)
        self.configProvider = configProvider
    }

    public func setConfigProvider(_ provider: ConfigProvider?) {
        self.configProvider = provider
    }

    public func clear() {
        messages.removeAll()
        lastError = nil
    }

    public func newConversation() {
        clear()
        conversationId = nil
    }

    public var selectedConversationTitle: String {
        guard let id = conversationId else { return "New chat" }
        if let c = conversations.first(where: { $0.id == id }) {
            let t = (c.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? "Conversation" : t
        }
        return "Conversation"
    }

    public func bootstrapIfPossible() {
        guard let cfg = configProvider?() else { return }
        guard !cfg.accessToken.isEmpty else { return }

        Task {
            await refreshConversations()
            if let convoId = conversationId {
                await loadConversation(conversationId: convoId)
            }
        }
    }

    public func refreshConversations() async {
        guard let cfg = configProvider?() else { return }
        guard !cfg.accessToken.isEmpty else { return }

        do {
            let list = try await api.listConversations(baseURL: cfg.baseURL, idToken: cfg.accessToken)
            await MainActor.run {
                self.conversations = list
            }
        } catch {
            // Best-effort; keep UI usable.
        }
    }

    public func selectConversation(_ id: String) {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        conversationId = trimmed
        clear()
        Task { await loadConversation(conversationId: trimmed) }
    }

    public func deleteConversation(_ id: String) {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard let cfg = configProvider?() else { return }
        guard !cfg.accessToken.isEmpty else { return }

        Task {
            do {
                try await api.deleteConversation(baseURL: cfg.baseURL, idToken: cfg.accessToken, conversationId: trimmed)
                await refreshConversations()
                await MainActor.run {
                    if self.conversationId == trimmed {
                        self.conversationId = nil
                        self.clear()
                    }
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
    }

    public func loadConversation(conversationId: String) async {
        guard let cfg = configProvider?() else { return }
        guard !cfg.accessToken.isEmpty else { return }

        do {
            let remote = try await api.listMessages(baseURL: cfg.baseURL, idToken: cfg.accessToken, conversationId: conversationId)
            await MainActor.run {
                self.messages = remote.map { dto in
                    let role = AgentChatRole(rawValue: dto.role) ?? .assistant
                    return AgentChatMessage(id: UUID(), role: role, text: dto.content)
                }
            }
        } catch {
            // Best-effort.
        }
    }

    public func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isSending else { return }

        lastError = nil
        draft = ""

        guard let cfg = configProvider?() else {
            lastError = "Backend URL not configured"
            return
        }

        guard !cfg.accessToken.isEmpty else {
            lastError = "Please sign in to chat."
            return
        }

        messages.append(AgentChatMessage(role: .user, text: text))
        isSending = true

        Task {
            do {
                let convoId = try await ensureConversation(baseURL: cfg.baseURL, accessToken: cfg.accessToken, firstUserMessage: text)

                // Stream into a placeholder assistant message.
                let placeholderId = UUID()
                await MainActor.run {
                    self.messages.append(AgentChatMessage(id: placeholderId, role: .assistant, text: ""))
                }

                var accumulated = ""

                try await api.chatStream(
                    baseURL: cfg.baseURL,
                    idToken: cfg.accessToken,
                    conversationId: convoId,
                    message: text,
                    onEvent: { [weak self] ev in
                        guard let self else { return }
                        Task { @MainActor in
                            switch ev {
                            case .delta(let d):
                                accumulated += d
                                if let idx = self.messages.firstIndex(where: { $0.id == placeholderId }) {
                                    self.messages[idx] = AgentChatMessage(id: placeholderId, role: .assistant, text: accumulated)
                                }
                            case .done(let msg, _):
                                if let idx = self.messages.firstIndex(where: { $0.id == placeholderId }) {
                                    self.messages[idx] = AgentChatMessage(id: placeholderId, role: .assistant, text: msg.content)
                                }
                            case .tool(let line):
                                // Show tool calls/results as system messages so users can see what the agent did.
                                self.messages.append(AgentChatMessage(role: .system, text: line))
                            case .error(let e):
                                self.lastError = e
                            }
                        }
                    }
                )

                await MainActor.run {
                    self.isSending = false
                }
            } catch {
                await MainActor.run {
                    self.lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.isSending = false
                }
            }
        }
    }

    private func ensureConversation(baseURL: URL, accessToken: String, firstUserMessage: String) async throws -> String {
        if let existing = conversationId { return existing }

        let title = firstUserMessage
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "\n")
            .first
            .map(String.init)

        let convo = try await api.createConversation(baseURL: baseURL, idToken: accessToken, title: title)
        let id = convo.id

        await MainActor.run {
            self.conversationId = id
        }

        return id
    }
}

