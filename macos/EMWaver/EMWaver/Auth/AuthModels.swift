import Foundation

struct AuthAccount: Equatable {
    let uid: String
    let email: String?
    let displayName: String?
}

enum AuthError: LocalizedError {
    case notConfigured
    case cancelled
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "API key sign-in is not configured in this build"
        case .cancelled:
            return "Sign-in cancelled"
        case .failed(let message):
            return message
        }
    }
}
