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
    @Published var isPresentingSettingsSheet: Bool = false
    @Published var newConversationTitle: String = ""
    @Published var renameConversationTitle: String = ""
    @Published var isShowingDeleteConfirmation: Bool = false
    @Published var isShowingChatsDialog: Bool = false

    private let service: AgentService
    private let defaults: UserDefaults
    private let lastSelectedConversationKey = "agent_last_selected_conversation"

    private var hasLoaded = false
    private var streamTask: Task<Void, Never>?

    init(
        service: AgentService = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.service = service
        self.defaults = defaults
        loadStoredConversations()
    }

    deinit {
        streamTask?.cancel()
    }

    func loadIfNeeded() {
        guard !hasLoaded else { return }
        hasLoaded = true
        refreshConversations()
    }

    func refreshConversations() {
        conversations = service.loadConversations()
        
        if let selected = selectedConversationId,
           !conversations.contains(where: { $0.id == selected }) {
            selectedConversationId = conversations.first?.id
        } else if selectedConversationId == nil {
            selectedConversationId = conversations.first?.id
        }

        if let conversationId = selectedConversationId {
            loadMessages(for: conversationId)
        } else {
            messages = []
        }
        
        saveLastSelectedConversation()
    }

    func loadMessages(for conversationId: String) {
        messages = service.loadMessages(conversationId: conversationId)
            .sorted(by: { $0.createdAt < $1.createdAt })
    }

    func selectConversation(id: String?) {
        guard selectedConversationId != id else { return }
        selectedConversationId = id
        saveLastSelectedConversation()
        messages = []

        guard let id else { return }
        loadMessages(for: id)
    }

    func createConversation(with title: String) {
        let conversationId = UUID().uuidString
        let conversationTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalTitle = conversationTitle.isEmpty ? "New Chat" : conversationTitle
        
        let conversation = AgentConversationSummary(
            id: conversationId,
            title: finalTitle,
            updatedAt: Date()
        )
        
        conversations.append(conversation)
        service.saveConversations(conversations)
        service.saveMessages(conversationId: conversationId, messages: [])
        
        selectConversation(id: conversationId)
    }

    func renameSelectedConversation(to title: String) {
        guard let conversationId = selectedConversationId else { return }
        
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalTitle = trimmed.isEmpty ? "Agent Chat" : trimmed
        
        guard let index = conversations.firstIndex(where: { $0.id == conversationId }) else { return }
        
        let updated = AgentConversationSummary(
            id: conversationId,
            title: finalTitle,
            updatedAt: Date()
        )
        
        conversations[index] = updated
        service.saveConversations(conversations)
        refreshConversations()
    }

    func deleteSelectedConversation() {
        guard let conversationId = selectedConversationId else { return }
        
        service.deleteConversation(id: conversationId)
        conversations.removeAll { $0.id == conversationId }
        service.saveConversations(conversations)

        if let first = conversations.first {
            selectedConversationId = first.id
            loadMessages(for: first.id)
        } else {
            selectedConversationId = nil
            messages = []
        }
        
        saveLastSelectedConversation()
    }

    func sendMessage() {
        let trimmed = messageInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messageInput = ""
        streamTask?.cancel()

        Task { [weak self] in
            await self?.performSendMessage(trimmed: trimmed)
        }
    }

    private func performSendMessage(trimmed message: String) async {
        var conversationId = selectedConversationId

        if conversationId == nil {
            createConversation(with: "")
            conversationId = selectedConversationId
        }

        guard let conversationId else { return }

        let userMessage = AgentMessage(role: .user, content: message, createdAt: Date())
        messages.append(userMessage)

        let assistantMessage = AgentMessage(role: .assistant, content: "")
        messages.append(assistantMessage)

        let assistantId = assistantMessage.id
        isStreaming = true

        let conversationHistory = messages.filter { $0.id != assistantId }
        
        streamTask = Task { [weak self] in
            guard let self else { return }
            await self.processStream(
                conversationId: conversationId,
                prompt: message,
                assistantId: assistantId,
                conversationHistory: conversationHistory
            )
        }
    }

    private func processStream(
        conversationId: String,
        prompt: String,
        assistantId: UUID,
        conversationHistory: [AgentMessage]
    ) async {
        do {
            let stream = service.streamMessage(
                conversationId: conversationId,
                message: prompt,
                conversationHistory: conversationHistory
            )
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
                    saveConversation(conversationId: conversationId)
                case .completed:
                    saveConversation(conversationId: conversationId)
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

    private func saveConversation(conversationId: String) {
        service.saveMessages(conversationId: conversationId, messages: messages)
        
        if let index = conversations.firstIndex(where: { $0.id == conversationId }) {
            let oldSummary = conversations[index]
            let updated = AgentConversationSummary(
                id: conversationId,
                title: oldSummary.title,
                updatedAt: Date()
            )
            conversations[index] = updated
            service.saveConversations(conversations)
        }
    }

    private func present(error: Error) {
        if let agentError = error as? AgentServiceError {
            errorMessage = agentError.errorDescription
        } else {
            errorMessage = error.localizedDescription
        }
        isShowingErrorAlert = true
    }

    private func loadStoredConversations() {
        conversations = service.loadConversations()
        
        if let lastSelectedId = defaults.string(forKey: lastSelectedConversationKey),
           conversations.contains(where: { $0.id == lastSelectedId }) {
            selectedConversationId = lastSelectedId
            loadMessages(for: lastSelectedId)
        } else if let first = conversations.first {
            selectedConversationId = first.id
            loadMessages(for: first.id)
        }
    }

    private func saveLastSelectedConversation() {
        if let id = selectedConversationId {
            defaults.set(id, forKey: lastSelectedConversationKey)
        } else {
            defaults.removeObject(forKey: lastSelectedConversationKey)
        }
    }
}
