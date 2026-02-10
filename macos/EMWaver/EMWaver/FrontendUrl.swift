import Foundation

/// Resolve the base URL for the EMWaver web frontend.
///
/// Used for flows that are easiest to keep web-first (e.g. Pro purchase) while we
/// keep the backend authoritative for entitlements.
///
/// Order:
/// 1) explicit UI switch: useProduction
/// 2) explicit UI local URL
/// 3) EMWAVER_FRONTEND_URL env var
enum FrontendUrl {
    static let productionAzure = "https://emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io"

    // Keys
    static let keyUseProduction = "emwaver.frontend.useProduction"
    static let keyLocalUrl = "emwaver.frontend.localURL"

    static func resolve() -> URL? {
        let defaults = UserDefaults.standard

        if defaults.bool(forKey: keyUseProduction) {
            return URL(string: productionAzure)
        }

        let local = (defaults.string(forKey: keyLocalUrl) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !local.isEmpty {
            return URL(string: local)
        }

        let envURL = (ProcessInfo.processInfo.environment["EMWAVER_FRONTEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !envURL.isEmpty {
            return URL(string: envURL)
        }

        // Default to local dev.
        return URL(string: "http://127.0.0.1:3000")
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
