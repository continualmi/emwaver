import Foundation

enum AgentEndpointUrl {
    static func resolve() -> URL? {
        let active = [
            AppEnvironment.string("EMWAVER_AGENT_ENDPOINT"),
            AppEnvironment.string("CONTINUAL_AGENT_ENDPOINT"),
        ]
        .first { !$0.isEmpty } ?? ""

        return URL(string: active)
    }
}
