import Foundation

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var isAuthenticated: Bool
    @Published private(set) var accessToken: String?

    init() {
        // Local-only mode: always authenticated with a local token
        self.isAuthenticated = true
        self.accessToken = "local-only-token"
    }

    func logout() {
        // No-op in local-only mode
    }
}
