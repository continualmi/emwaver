import Foundation

/// Compatibility wrapper kept to avoid stale project references while auth
/// ownership finishes moving fully into the EMWaver frontend/backend pair.
enum SocietyUrl {
    static func resolve() -> URL? {
        FrontendUrl.resolve()
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
