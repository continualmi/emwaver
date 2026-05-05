import Foundation

enum AgentEndpointUrl {
    static func resolve() -> URL? {
        let active = [
            ProcessInfo.processInfo.environment["EMWAVER_AGENT_ENDPOINT"] ?? "",
            ProcessInfo.processInfo.environment["CONTINUAL_AGENT_ENDPOINT"] ?? "",
        ]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .first { !$0.isEmpty } ?? ""

        return URL(string: active)
    }
}
