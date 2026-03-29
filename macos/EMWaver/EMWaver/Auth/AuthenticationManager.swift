import Combine
import Foundation

#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isSigningIn = false
    @Published private(set) var didCompleteInitialRestore = false
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

        // Close the sign-in sheet first; SwiftUI doesn't reliably present two sheets at once.
        isSignInSheetPresented = false

        // Open the canonical shared Continual handoff page and then prompt for the code.
        guard var base = FrontendUrl.resolve() else {
            lastError = "Missing EMWaver frontend URL"
            return
        }
        base.appendPathComponent("emwaver")
        base.appendPathComponent("handoff")
#if canImport(AppKit)
        NSWorkspace.shared.open(base)
        #endif

        // Present the handoff sheet after the sign-in sheet has had a moment to dismiss.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.isWebHandoffSheetPresented = true
        }
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
            lastError = "Missing EMWaver backend URL"
            return
        }

        var consumeURL = base

        do {
            consumeURL.appendPathComponent("v1")
            consumeURL.appendPathComponent("auth")
            consumeURL.appendPathComponent("handoff")
            consumeURL.appendPathComponent("consume")

            var req = URLRequest(url: consumeURL)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: [
                "code": trimmed,
            ])

            let (data, res) = try await URLSession.shared.data(for: req)
            let http = (res as? HTTPURLResponse)?.statusCode ?? -1
            if http < 200 || http >= 300 {
                let msg = String(data: data, encoding: .utf8) ?? ""
                let detail = msg.isEmpty ? "HTTP \(http)" : msg
                throw AuthError.failed("Handoff consume failed at \(consumeURL.absoluteString): \(detail)")
            }

            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let accessToken = (json?["access_token"] as? String) ?? (json?["handoff_token"] as? String) ?? ""
            if accessToken.isEmpty {
                throw AuthError.failed("Missing session token")
            }
            let user = json?["user"] as? [String: Any]

            let newSession = AuthSession(
                uid: (user?["uid"] as? String) ?? "",
                email: user?["email"] as? String,
                displayName: user?["name"] as? String,
                idToken: accessToken,
                refreshToken: accessToken
            )

            // Persist refresh token + profile for restore.
            try KeychainStore.setString(newSession.refreshToken, account: refreshTokenAccount)
            let profile = StoredProfile(uid: newSession.uid, email: newSession.email, displayName: newSession.displayName)
            let profileData = try JSONEncoder().encode(profile)
            let profileStr = String(data: profileData, encoding: .utf8) ?? ""
            try KeychainStore.setString(profileStr, account: profileAccount)

            session = newSession
        } catch let urlError as URLError {
            lastError = "Could not reach \(consumeURL.absoluteString): \(urlError.localizedDescription)"
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            if message.isEmpty {
                lastError = "Handoff consume failed at \(consumeURL.absoluteString)"
            } else {
                lastError = message
            }
        }
    }

    func signOut() async {
        await provider.signOut()
        KeychainStore.delete(account: refreshTokenAccount)
        KeychainStore.delete(account: profileAccount)
        session = nil
    }

    func waitForInitialRestore() async {
        while !didCompleteInitialRestore {
            await Task.yield()
        }
    }

    // MARK: - Restore

    private func restoreSessionIfPossible() async {
        defer { didCompleteInitialRestore = true }

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
