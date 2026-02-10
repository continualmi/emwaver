import Combine
import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isSigningIn = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false
    @Published var isWebHandoffSheetPresented = false

    private let provider: GoogleSignInProviding
    private let firebase = FirebaseAuthService()

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

    // MARK: - Web sign-in handoff

    func beginWebSignInHandoff() {
        lastError = nil

        // Open the EMWaver web sign-in page and then prompt for the code.
        guard var base = FrontendUrl.resolve() else {
            lastError = "Missing frontend URL"
            return
        }
        base.appendPathComponent("signin")
        // redirect to /auth/handoff to show the code.
        let urlStr = base.absoluteString + "?redirect=%2Fauth%2Fhandoff"
        if let url = URL(string: urlStr) {
            import AppKit
            AppKit.NSWorkspace.shared.open(url)
        }

        isWebHandoffSheetPresented = true
    }

    func consumeWebHandoffCode(code: String) async {
        guard !isSigningIn else { return }
        lastError = nil
        isSigningIn = true
        defer { isSigningIn = false }

        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            lastError = "Missing code"
            return
        }

        guard let base = BackendUrl.resolve() else {
            lastError = "Missing backend URL"
            return
        }

        let apiKey = (ProcessInfo.processInfo.environment["EMWAVER_FIREBASE_WEB_API_KEY"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if apiKey.isEmpty {
            lastError = "Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)"
            return
        }

        do {
            // Consume handoff code -> custom token.
            var consumeURL = base
            consumeURL.appendPathComponent("v1")
            consumeURL.appendPathComponent("auth")
            consumeURL.appendPathComponent("handoff")
            consumeURL.appendPathComponent("consume")

            var req = URLRequest(url: consumeURL)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["code": trimmed])

            let (data, res) = try await URLSession.shared.data(for: req)
            let http = (res as? HTTPURLResponse)?.statusCode ?? -1
            if http < 200 || http >= 300 {
                let msg = String(data: data, encoding: .utf8) ?? ""
                throw AuthError.failed(msg.isEmpty ? "HTTP \(http)" : msg)
            }

            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let customToken = (json?["firebase_custom_token"] as? String) ?? ""
            if customToken.isEmpty {
                throw AuthError.failed("Missing firebase_custom_token")
            }

            // Exchange custom token for Firebase session (idToken + refreshToken).
            let fb = try await firebase.signInWithCustomToken(firebaseWebApiKey: apiKey, customToken: customToken)

            let newSession = AuthSession(
                uid: fb.localId ?? "",
                email: fb.email,
                displayName: fb.displayName,
                idToken: fb.idToken,
                refreshToken: fb.refreshToken
            )

            // Persist refresh token + profile for restore.
            try KeychainStore.setString(newSession.refreshToken, account: refreshTokenAccount)
            let profile = StoredProfile(uid: newSession.uid, email: newSession.email, displayName: newSession.displayName)
            let profileData = try JSONEncoder().encode(profile)
            let profileStr = String(data: profileData, encoding: .utf8) ?? ""
            try KeychainStore.setString(profileStr, account: profileAccount)

            session = newSession
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func signOut() async {
        await provider.signOut()
        KeychainStore.delete(account: refreshTokenAccount)
        KeychainStore.delete(account: profileAccount)
        session = nil
    }

    // MARK: - Restore

    private func restoreSessionIfPossible() async {
        // Avoid fighting an interactive sign-in.
        guard session == nil else { return }

        do {
            let apiKey = (ProcessInfo.processInfo.environment["EMWAVER_FIREBASE_WEB_API_KEY"] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !apiKey.isEmpty else { return }

            guard let refresh = try KeychainStore.getString(account: refreshTokenAccount), !refresh.isEmpty else {
                return
            }

            var storedProfile: StoredProfile? = nil
            if let raw = try KeychainStore.getString(account: profileAccount) {
                if let data = raw.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(StoredProfile.self, from: data) {
                    storedProfile = decoded
                }
            }

            let fb = try await firebase.refresh(firebaseWebApiKey: apiKey, refreshToken: refresh)

            let newSession = AuthSession(
                uid: storedProfile?.uid ?? (fb.localId ?? ""),
                email: storedProfile?.email,
                displayName: storedProfile?.displayName,
                idToken: fb.idToken,
                refreshToken: fb.refreshToken
            )

            // Save rotated refresh token.
            try KeychainStore.setString(newSession.refreshToken, account: refreshTokenAccount)
            session = newSession
        } catch {
            // Best-effort: clear invalid tokens.
            KeychainStore.delete(account: refreshTokenAccount)
            KeychainStore.delete(account: profileAccount)
        }
    }
}
