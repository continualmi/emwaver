import Foundation

struct AuthSession: Equatable {
    let uid: String
    let email: String?
    let displayName: String?
    let idToken: String

    // Stored in Keychain for session restore.
    let refreshToken: String
}

enum AuthError: LocalizedError {
    case notConfigured
    case cancelled
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Sign in is not configured in this build"
        case .cancelled:
            return "Sign in cancelled"
        case .failed(let message):
            return message
        }
    }
}
