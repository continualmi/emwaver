import Foundation

enum BackendUrl {
    static func resolve() -> URL? {
        let active = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: active)
    }

    static func effectiveString() -> String {
        resolve()?.absoluteString ?? ""
    }
}

enum AgentEndpointUrl {
    static func resolve() -> URL? {
        let env = ProcessInfo.processInfo.environment
        let active = (env["EMWAVER_AGENT_ENDPOINT"] ?? env["CONTINUAL_AGENT_ENDPOINT"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return URL(string: active)
    }
}
