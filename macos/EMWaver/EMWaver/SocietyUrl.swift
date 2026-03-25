import Foundation

/// Resolve the base URL for the Society site.
///
/// Used for Continual handoff flows that are initiated by Society and completed by the macOS app.
enum SocietyUrl {
    static func resolve() -> URL? {
        let active = (ProcessInfo.processInfo.environment["SOCIETY_SITE_URL"] ?? "https://continualmi.com")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: active)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
