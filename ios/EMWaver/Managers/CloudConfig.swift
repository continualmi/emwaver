import Foundation

enum CloudConfig {
    static let productionBackend = "https://emwaver-web.azurewebsites.net"

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

    static func hostedServicesEnabled() -> Bool {
        AppEnvironment.string("EMWAVER_HOSTED_SERVICES_UI_ENABLED") == "1"
    }

    static func hostedRemoteControlEnabled() -> Bool {
        AppEnvironment.string("EMWAVER_HOSTED_REMOTE_CONTROL_ENABLED") == "1"
    }
}
