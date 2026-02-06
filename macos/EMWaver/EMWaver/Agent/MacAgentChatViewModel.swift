import Combine
import Foundation
import SwiftUI

@MainActor
final class MacAgentChatViewModel: ObservableObject {
    enum Role: String {
        case user
        case assistant
        case system
    }

    struct Message: Identifiable, Equatable {
        let id: String
        let role: Role
        var text: String
        let createdAtMs: Int64

        init(id: String = UUID().uuidString, role: Role, text: String, createdAtMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
            self.id = id
            self.role = role
            self.text = text
            self.createdAtMs = createdAtMs
        }
    }

    @Published private(set) var messages: [Message] = []
    @Published var draft: String = ""
    @Published var isSending: Bool = false
    @Published var lastError: String?
    @Published var conversationId: String?

    private let api: AgentAPI
    private let idTokenProvider: () -> String

    private let convoDefaultsKey = "emwaver.agent.conversationId"

    init(api: AgentAPI = AgentAPI(), idTokenProvider: @escaping () -> String) {
        self.api = api
        self.idTokenProvider = idTokenProvider
        self.conversationId = UserDefaults.standard.string(forKey: convoDefaultsKey)
    }

    func bootstrapIfPossible() {
        // Load existing conversation history if we have config + auth + conversation id.
        guard let cfg = backendConfig(), let convoId = conversationId else { return }

        Task {
            do {
                let remote = try await api.listMessages(baseURL: cfg.baseURL, idToken: cfg.accessToken, conversationId: convoId)
                await MainActor.run {
                    self.messages = remote.compactMap { dto in
                        let role = Role(rawValue: dto.role) ?? .assistant
                        return Message(id: dto.id, role: role, text: dto.content, createdAtMs: dto.created_at_ms)
                    }
                }
            } catch {
                // Non-fatal.
            }
        }
    }

    func newConversation() {
        lastError = nil
        messages.removeAll()
        conversationId = nil
        UserDefaults.standard.removeObject(forKey: convoDefaultsKey)
    }

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard !isSending else { return }

        lastError = nil
        draft = ""

        // Require auth (same as frontend).
        guard let cfg = backendConfig() else {
            lastError = "Backend URL not configured"
            return
        }
        guard !cfg.accessToken.isEmpty else {
            lastError = "Please sign in to chat."
            return
        }

        // append user msg
        messages.append(Message(role: .user, text: text))

        isSending = true

        Task {
            do {
                let convoId = try await ensureConversation(baseURL: cfg.baseURL, idToken: cfg.accessToken, firstUserMessage: text)

                // Create a placeholder assistant message we will stream into.
                let assistantLocalId = UUID().uuidString
                await MainActor.run {
                    self.messages.append(Message(id: assistantLocalId, role: .assistant, text: ""))
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
                                if let idx = self.messages.firstIndex(where: { $0.id == assistantLocalId }) {
                                    self.messages[idx].text = accumulated
                                }
                            case .done(let msg, _):
                                // Replace placeholder with persisted msg id/content.
                                if let idx = self.messages.firstIndex(where: { $0.id == assistantLocalId }) {
                                    self.messages[idx] = Message(id: msg.id, role: .assistant, text: msg.content, createdAtMs: msg.created_at_ms)
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

    // MARK: - Config

    private func backendConfig() -> (baseURL: URL, accessToken: String)? {
        let envURL = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let defaultsURL = (UserDefaults.standard.string(forKey: "emwaver.agent.backendURL") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let raw = !envURL.isEmpty ? envURL : defaultsURL
        guard !raw.isEmpty, let base = URL(string: raw) else { return nil }

        let token = idTokenProvider()
        return (baseURL: base, accessToken: token)
    }

    private func ensureConversation(baseURL: URL, idToken: String, firstUserMessage: String) async throws -> String {
        if let existing = conversationId, !existing.isEmpty {
            return existing
        }

        let title = firstUserMessage
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "\n")
            .first
            .map(String.init)

        let convo = try await api.createConversation(baseURL: baseURL, idToken: idToken, title: title)
        let id = convo.id

        await MainActor.run {
            self.conversationId = id
            UserDefaults.standard.set(id, forKey: convoDefaultsKey)
        }

        return id
    }
}
