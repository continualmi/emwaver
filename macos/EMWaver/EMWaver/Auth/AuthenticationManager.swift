import Combine
import Foundation

#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var account: AuthAccount?
    @Published private(set) var accessToken: String = ""
    @Published private(set) var hasSavedKey = false
    @Published private(set) var isValidatingKey = false
    @Published private(set) var didCompleteInitialRestore = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let apiKeyAccount = "emwaver_api_key"
    private let profileAccount = "emwaver_api_key_profile"

    private struct StoredProfile: Codable {
        var uid: String
        var email: String?
        var displayName: String?
    }

    init() {
        Task { [weak self] in
            await self?.restoreCredentialIfPossible()
        }
    }

    var isSignedIn: Bool {
        hasSavedKey && account != nil
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

    func saveApiKey(_ apiKey: String) async {
        guard !isValidatingKey else { return }
        lastError = nil
        isValidatingKey = true
        defer { isValidatingKey = false }

        do {
            let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw AuthError.failed("Enter an Agent API key.")
            }

            try KeychainStore.setString(trimmed, account: apiKeyAccount)
            let profile = AuthAccount(uid: "agent-key", email: nil, displayName: "Agent key")
            try persistProfile(profile)
            accessToken = trimmed
            hasSavedKey = true
            account = profile
            isSignInSheetPresented = false
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func removeKey() async {
        clearStoredCredential(lastError: nil)
    }

    func openAccountManagement() {
        lastError = "Agent API-key setup is local to this app."
    }

    func waitForInitialRestore() async {
        while !didCompleteInitialRestore {
            await Task.yield()
        }
    }

    func handleUnauthorizedResponse(message: String = "Saved Agent key is no longer valid. Enter a new key to keep using Agent replies.") {
        clearStoredCredential(lastError: message)
    }

    private func persistProfile(_ profile: AuthAccount) throws {
        let stored = StoredProfile(uid: profile.uid, email: profile.email, displayName: profile.displayName)
        let profileData = try JSONEncoder().encode(stored)
        let profileStr = String(data: profileData, encoding: .utf8) ?? ""
        try KeychainStore.setString(profileStr, account: profileAccount)
    }

    private func restoreCredentialIfPossible() async {
        defer { didCompleteInitialRestore = true }

        do {
            guard let token = try KeychainStore.getString(account: apiKeyAccount), !token.isEmpty else {
                return
            }

            accessToken = token
            hasSavedKey = true

            var storedProfile: StoredProfile? = nil
            if let raw = try KeychainStore.getString(account: profileAccount) {
                if let data = raw.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(StoredProfile.self, from: data) {
                    storedProfile = decoded
                }
            }

            if let storedProfile, !storedProfile.uid.isEmpty {
                account = AuthAccount(
                    uid: storedProfile.uid,
                    email: storedProfile.email,
                    displayName: storedProfile.displayName
                )
            } else {
                account = nil
            }
        } catch {
            clearStoredCredential(lastError: nil)
        }
    }

    private func clearStoredCredential(lastError: String?) {
        KeychainStore.delete(account: apiKeyAccount)
        KeychainStore.delete(account: profileAccount)
        accessToken = ""
        hasSavedKey = false
        account = nil
        self.lastError = lastError
    }
}
