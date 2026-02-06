import Foundation

enum CloudConfig {
    private static let backendURLKeyNew = "emwaver.cloud.backend_url"
    private static let backendURLKeyLegacy = "emwaver.agent.backendURL"

    static func backendBaseURL() -> URL? {
        let env = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !env.isEmpty {
            return URL(string: env)
        }

        let defaults = UserDefaults.standard
        let raw = (
            defaults.string(forKey: backendURLKeyNew)
            ?? defaults.string(forKey: backendURLKeyLegacy)
            ?? ""
        ).trimmingCharacters(in: .whitespacesAndNewlines)

        if !raw.isEmpty {
            return URL(string: raw)
        }

        // Default (matches Android + docs)
        return URL(string: "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io")
    }

    static func setBackendBaseURLString(_ url: String) {
        UserDefaults.standard.set(url.trimmingCharacters(in: .whitespacesAndNewlines), forKey: backendURLKeyNew)
    }

    static func allowAnonSync() -> Bool {
        // Parity with macOS/Windows: anon sync is only enabled explicitly.
        let env = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return env == "1"
    }
}

