import Combine
import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isSigningIn = false
    @Published private(set) var accessToken: String = ""
    @Published private(set) var hasSavedKey = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let provider: GoogleSignInProviding

    private let refreshTokenAccount = "firebase_refresh_token"
    private let profileAccount = "firebase_profile"
    private let agentApiKeyAccount = "agent_api_key"

    private struct StoredProfile: Codable {
        var uid: String
        var email: String?
        var displayName: String?
    }

    init(provider: GoogleSignInProviding? = nil) {
        self.provider = provider ?? GoogleOAuthSignInProvider()

        // Best-effort session restore.
        Task { [weak self] in
            await self?.restoreSessionIfPossible()
        }
    }

    var isSignedIn: Bool {
        session != nil
    }

    var canSignInWithGoogle: Bool {
        provider.isAvailable
    }

    var userLabel: String {
        if hasSavedKey {
            return "Agent key"
        }
        if let name = session?.displayName, !name.isEmpty {
            return name
        }
        if let email = session?.email, !email.isEmpty {
            return email
        }
        return "No key"
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

    func signInWithGoogle() async {
        guard !isSigningIn else { return }
        lastError = nil
        isSigningIn = true
        defer { isSigningIn = false }

        do {
            let s = try await provider.signIn()
            session = s

            // Persist refresh token + profile for restore.
            try KeychainStore.setString(s.refreshToken, account: refreshTokenAccount)
            let profile = StoredProfile(uid: s.uid, email: s.email, displayName: s.displayName)
            let profileData = try JSONEncoder().encode(profile)
            let profileStr = String(data: profileData, encoding: .utf8) ?? ""
            try KeychainStore.setString(profileStr, account: profileAccount)
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func signOut() async {
        KeychainStore.delete(account: refreshTokenAccount)
        KeychainStore.delete(account: profileAccount)
        session = nil
    }

    // MARK: - Restore

    private func restoreSessionIfPossible() async {
        // Avoid fighting an interactive sign-in.
        guard session == nil else { return }

        do {
            guard let token = try KeychainStore.getString(account: refreshTokenAccount), !token.isEmpty else {
                restoreAgentKeyIfPossible()
                return
            }

            var storedProfile: StoredProfile? = nil
            if let raw = try KeychainStore.getString(account: profileAccount) {
                if let data = raw.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(StoredProfile.self, from: data) {
                    storedProfile = decoded
                }
            }

            let newSession = AuthSession(
                uid: storedProfile?.uid ?? "",
                email: storedProfile?.email,
                displayName: storedProfile?.displayName,
                idToken: token,
                refreshToken: token
            )

            session = newSession
            restoreAgentKeyIfPossible()
        } catch {
            // Best-effort: clear invalid tokens.
            KeychainStore.delete(account: refreshTokenAccount)
            KeychainStore.delete(account: profileAccount)
            restoreAgentKeyIfPossible()
        }
    }

    private func restoreAgentKeyIfPossible() {
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
