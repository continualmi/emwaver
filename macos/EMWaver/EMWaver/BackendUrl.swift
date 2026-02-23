import Foundation

enum BackendUrl {
    // Keys
    static let keyUseProduction = "emwaver.backend.useProduction"

    static var productionAzure: String {
        (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL_CLOUD"] ??
         "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static var localDefault: String {
        (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL_LOCAL"] ?? "http://127.0.0.1:8787")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Resolve backend base URL from fixed cloud/local choices.
    static func resolve() -> URL? {
        let defaults = UserDefaults.standard
        let selected = defaults.bool(forKey: keyUseProduction) ? productionAzure : localDefault
        return URL(string: selected)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
