import Combine
import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isSigningIn = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let provider: GoogleSignInProviding

    private let refreshTokenAccount = "firebase_refresh_token"
    private let profileAccount = "firebase_profile"

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
        if let name = session?.displayName, !name.isEmpty {
            return name
        }
        if let email = session?.email, !email.isEmpty {
            return email
        }
        return "Account"
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
        } catch {
            // Best-effort: clear invalid tokens.
            KeychainStore.delete(account: refreshTokenAccount)
            KeychainStore.delete(account: profileAccount)
        }
    }
}
