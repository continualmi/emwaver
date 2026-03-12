import Foundation

/// Resolve the base URL for the EMWaver web frontend.
///
/// Used for flows that are easiest to keep web-first (e.g. Pro purchase) while we
/// keep the backend authoritative for entitlements.
enum FrontendUrl {
    static func resolve() -> URL? {
        let active = (ProcessInfo.processInfo.environment["EMWAVER_FRONTEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: active)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
