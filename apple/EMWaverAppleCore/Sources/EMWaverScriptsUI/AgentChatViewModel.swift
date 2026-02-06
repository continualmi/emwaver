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

    // Backend config is provided by the host app (usually the same config used for cloud sync).
    public typealias ConfigProvider = () -> (baseURL: URL, accessToken: String)?

    private let api: AgentBackendAPI
    private let configProvider: ConfigProvider?

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

    public func clear() {
        messages.removeAll()
        lastError = nil
    }

    public func newConversation() {
        clear()
        conversationId = nil
    }

    public func bootstrapIfPossible() {
        guard let cfg = configProvider?() else { return }
        guard !cfg.accessToken.isEmpty else { return }
        guard let convoId = conversationId else { return }

        Task {
            do {
                let remote = try await api.listMessages(baseURL: cfg.baseURL, idToken: cfg.accessToken, conversationId: convoId)
                await MainActor.run {
                    self.messages = remote.map { dto in
                        let role = AgentChatRole(rawValue: dto.role) ?? .assistant
                        return AgentChatMessage(id: UUID(), role: role, text: dto.content)
                    }
                }
            } catch {
                // Non-fatal.
            }
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

