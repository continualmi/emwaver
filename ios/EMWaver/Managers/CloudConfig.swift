import Foundation

enum CloudConfig {
    static let productionBackend = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io"

    static func backendBaseURL() -> URL? {
        // Product direction: iOS talks to the fixed production backend.
        // (No local override or env override in end-user app.)
        return URL(string: productionBackend)
    }

    static func allowAnonSync() -> Bool {
        // Parity with macOS/Windows: anon sync is only enabled explicitly.
        let env = AppEnvironment.string("EMWAVER_ALLOW_ANON_SYNC")
        return env == "1"
    }
}
