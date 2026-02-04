import Combine
import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isSigningIn = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let provider: GoogleSignInProviding

    init(provider: GoogleSignInProviding = GoogleOAuthSignInProvider()) {
        self.provider = provider
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
            session = try await provider.signIn()
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func signOut() async {
        await provider.signOut()
        session = nil
    }
}
