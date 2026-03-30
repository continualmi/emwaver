import Foundation

protocol GoogleSignInProviding {
    var isAvailable: Bool { get }
    func signIn() async throws -> AuthAccount
    func signOut() async
}

final class NotConfiguredGoogleSignInProvider: GoogleSignInProviding {
    var isAvailable: Bool { false }

    func signIn() async throws -> AuthAccount {
        throw AuthError.notConfigured
    }

    func signOut() async {
        // No-op.
    }
}
