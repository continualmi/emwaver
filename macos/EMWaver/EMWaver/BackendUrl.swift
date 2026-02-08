import Foundation

enum BackendUrl {
    static let productionAzure = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io"

    // Keys
    static let keyUseProduction = "emwaver.backend.useProduction"
    static let keyLocalUrl = "emwaver.backend.localURL"

    /// Resolve backend base URL.
    ///
    /// Order:
    /// 1) explicit UI switch: useProduction
    /// 2) explicit UI local URL
    /// 3) EMWAVER_BACKEND_URL env var (scheme override)
    /// 4) legacy UserDefaults key: emwaver.agent.backendURL
    static func resolve() -> URL? {
        let defaults = UserDefaults.standard

        if defaults.bool(forKey: keyUseProduction) {
            return URL(string: productionAzure)
        }

        let local = (defaults.string(forKey: keyLocalUrl) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !local.isEmpty {
            return URL(string: local)
        }

        let envURL = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !envURL.isEmpty {
            return URL(string: envURL)
        }

        let legacy = (defaults.string(forKey: "emwaver.agent.backendURL") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !legacy.isEmpty {
            return URL(string: legacy)
        }

        return nil
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}
