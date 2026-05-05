import Foundation

enum AgentEndpointUrl {
    static func resolve() -> URL? {
        let active = [
            AppEnvironment.string("EMWAVER_AGENT_ENDPOINT"),
            AppEnvironment.string("CONTINUAL_AGENT_ENDPOINT"),
            Bundle.main.object(forInfoDictionaryKey: "AgentEndpointURL") as? String ?? "",
        ]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .first { !$0.isEmpty } ?? ""

        return URL(string: active)
    }
}
