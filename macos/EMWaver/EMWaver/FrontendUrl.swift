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
    // Keys
    static let keyUseProduction = "emwaver.frontend.useProduction"

    static var productionAzure: String {
        (ProcessInfo.processInfo.environment["EMWAVER_FRONTEND_URL_CLOUD"] ??
         "https://emwaver-frontend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static var localDefault: String {
        (ProcessInfo.processInfo.environment["EMWAVER_FRONTEND_URL_LOCAL"] ?? "http://127.0.0.1:3200")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func resolve() -> URL? {
        let defaults = UserDefaults.standard
        return URL(string: defaults.bool(forKey: keyUseProduction) ? productionAzure : localDefault)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
