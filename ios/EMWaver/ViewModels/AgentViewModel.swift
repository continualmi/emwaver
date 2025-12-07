import Foundation

@MainActor
final class AgentViewModel: ObservableObject {
    @Published private(set) var conversations: [AgentConversationSummary] = []
    @Published var selectedConversationId: String?
    @Published private(set) var messages: [AgentMessage] = []
    @Published var messageInput: String = ""
    @Published var isLoading: Bool = false
    @Published var isStreaming: Bool = false
    @Published var errorMessage: String?
    @Published var isShowingErrorAlert: Bool = false
    @Published var isPresentingNewConversationSheet: Bool = false
    @Published var isPresentingRenameSheet: Bool = false
    @Published var newConversationTitle: String = ""
    @Published var renameConversationTitle: String = ""
    @Published var isShowingDeleteConfirmation: Bool = false

    private let service: AgentService
    private let authManager: AuthenticationManager
    private let defaults: UserDefaults
    private let conversationStorageKey = "agent.conversations"

    private var hasLoaded = false
    private var streamTask: Task<Void, Never>?

    init(
        service: AgentService = .shared,
        authManager: AuthenticationManager,
        defaults: UserDefaults = .standard
    ) {
        self.service = service
        self.authManager = authManager
        self.defaults = defaults
        loadStoredConversations()
    }

    deinit {
        streamTask?.cancel()
    }

    func loadIfNeeded() {
        guard !hasLoaded else { return }
        hasLoaded = true
        Task {
            await refreshConversations()
        }
    }

    func refreshConversations() async {
        guard let token = tokenOrNotify() else { return }

        do {
            let remote = try await service.fetchConversations(accessToken: token)
            conversations = sort(remote)
            persist(conversations: conversations)

            if let selected = selectedConversationId,
               !conversations.contains(where: { $0.id == selected }) {
                selectedConversationId = conversations.first?.id
            } else if selectedConversationId == nil {
                selectedConversationId = conversations.first?.id
            }

            if let conversationId = selectedConversationId {
                await loadMessages(for: conversationId)
            } else {
                messages = []
            }
        } catch {
            present(error: error)
        }
    }

    func loadMessages(for conversationId: String) async {
        guard let token = tokenOrNotify() else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let loaded = try await service.fetchMessages(conversationId: conversationId, accessToken: token)
            messages = loaded.sorted(by: { $0.createdAt < $1.createdAt })
        } catch {
            present(error: error)
        }
    }

    func selectConversation(id: String?) {
        guard selectedConversationId != id else { return }
        selectedConversationId = id
        messages = []

        guard let id else { return }
        Task {
            await loadMessages(for: id)
        }
    }

    func createConversation(with title: String) {
        guard let token = tokenOrNotify() else { return }

        Task {
            do {
                let conversation = try await service.createConversation(title: title, accessToken: token)
                update(conversation: conversation, select: true)
                await loadMessages(for: conversation.id)
            } catch {
                present(error: error)
            }
        }
    }

    func renameSelectedConversation(to title: String) {
        guard let conversationId = selectedConversationId,
              let token = tokenOrNotify()
        else { return }

        Task {
            do {
                let updated = try await service.renameConversation(id: conversationId, title: title, accessToken: token)
                update(conversation: updated, select: true)
            } catch {
                present(error: error)
            }
        }
    }

    func deleteSelectedConversation() {
        guard let conversationId = selectedConversationId,
              let token = tokenOrNotify()
        else { return }

        Task {
            do {
                try await service.deleteConversation(id: conversationId, accessToken: token)
                conversations.removeAll { $0.id == conversationId }
                persist(conversations: conversations)

                if let first = conversations.first {
                    selectedConversationId = first.id
                    await loadMessages(for: first.id)
                } else {
                    selectedConversationId = nil
                    messages = []
                }
            } catch {
                present(error: error)
            }
        }
    }

    func sendMessage() {
        let trimmed = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        guard let token = tokenOrNotify() else { return }

        messageInput = ""
        streamTask?.cancel()

        Task { [weak self] in
            await self?.performSendMessage(trimmed: trimmed, token: token)
        }
    }

    private func performSendMessage(trimmed message: String, token: String) async {
        var conversationId = selectedConversationId

        if conversationId == nil {
            do {
                let conversation = try await service.createConversation(title: "Agent Chat", accessToken: token)
                update(conversation: conversation, select: true)
                conversationId = conversation.id
            } catch {
                present(error: error)
                return
            }
        }

        guard let conversationId else { return }

        let userMessage = AgentMessage(role: .user, content: message, createdAt: Date())
        messages.append(userMessage)

        let assistantMessage = AgentMessage(role: .assistant, content: "")
        messages.append(assistantMessage)

        let assistantId = assistantMessage.id
        isStreaming = true

        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.processStream(
                conversationId: conversationId,
                prompt: message,
                assistantId: assistantId,
                token: token
            )
        }
    }

    private func processStream(
        conversationId: String,
        prompt: String,
        assistantId: UUID,
        token: String
    ) async {
        do {
            let stream = service.streamMessage(conversationId: conversationId, message: prompt, accessToken: token)
            var accumulated = ""

            for try await event in stream {
                if Task.isCancelled { break }
                switch event {
                case .delta(let delta):
                    accumulated.append(delta)
                    updateAssistantMessage(id: assistantId, with: accumulated)
                case .final(let text):
                    accumulated = text
                    updateAssistantMessage(id: assistantId, with: accumulated)
                    await refreshConversations()
                case .completed:
                    break
                case .error(let message):
                    accumulated = message
                    updateAssistantMessage(id: assistantId, with: accumulated)
                }
            }
        } catch {
            updateAssistantMessage(id: assistantId, with: error.localizedDescription)
            present(error: error)
        }

        isStreaming = false
    }

    func cancelStreaming() {
        streamTask?.cancel()
        streamTask = nil
        isStreaming = false
    }

    private func updateAssistantMessage(id: UUID, with content: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].content = content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func tokenOrNotify() -> String? {
        guard let token = authManager.accessToken, !token.isEmpty else {
            present(error: AgentServiceError.missingAccessToken)
            return nil
        }
        return token
    }

    private func present(error: Error) {
        if let agentError = error as? AgentServiceError {
            errorMessage = agentError.errorDescription
        } else {
            errorMessage = error.localizedDescription
        }
        isShowingErrorAlert = true
    }

    private func update(conversation: AgentConversationSummary, select: Bool) {
        if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
            conversations[index] = conversation
        } else {
            conversations.append(conversation)
        }

        conversations = sort(conversations)
        persist(conversations: conversations)

        if select {
            selectedConversationId = conversation.id
        }
    }

    private func sort(_ items: [AgentConversationSummary]) -> [AgentConversationSummary] {
        items.sorted(by: { $0.updatedAt > $1.updatedAt })
    }

    private func loadStoredConversations() {
        guard let data = defaults.data(forKey: conversationStorageKey) else { return }
        let decoder = JSONDecoder()
        if let stored = try? decoder.decode([AgentConversationSummary].self, from: data) {
            conversations = sort(stored)
            selectedConversationId = conversations.first?.id
        }
    }

    private func persist(conversations: [AgentConversationSummary]) {
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(conversations) {
            defaults.set(data, forKey: conversationStorageKey)
        }
    }

}
