import Combine
import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var accessToken: String = ""
    @Published private(set) var hasSavedKey = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let agentApiKeyAccount = "agent_api_key"

    init() {
        Task { [weak self] in
            await self?.restoreAgentKeyIfPossible()
        }
    }

    var isSignedIn: Bool {
        hasSavedKey
    }

    var userLabel: String {
        hasSavedKey ? "Agent key" : "No key"
    }

    var agentEndpointConfig: (baseURL: URL, accessToken: String)? {
        guard hasSavedKey, !accessToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        guard let endpoint = AgentEndpointUrl.resolve() else {
            return nil
        }
        return (baseURL: endpoint, accessToken: accessToken)
    }

    func saveAgentApiKey(_ apiKey: String) async {
        lastError = nil

        do {
            let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw AuthError.failed("Enter an Agent API key.")
            }

            try KeychainStore.setString(trimmed, account: agentApiKeyAccount)
            accessToken = trimmed
            hasSavedKey = true
            isSignInSheetPresented = false
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func clearAgentApiKey() {
        KeychainStore.delete(account: agentApiKeyAccount)
        accessToken = ""
        hasSavedKey = false
    }

    private func restoreAgentKeyIfPossible() async {
        do {
            let key = (try KeychainStore.getString(account: agentApiKeyAccount) ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            accessToken = key
            hasSavedKey = !key.isEmpty
        } catch {
            KeychainStore.delete(account: agentApiKeyAccount)
            accessToken = ""
            hasSavedKey = false
        }
    }
}
