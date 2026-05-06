import Foundation

enum AgentEndpointUrl {
    private static let defaultEndpoint = "https://mdl.continualmi.com/api/mgpt/responses"

    static func resolve() -> URL? {
        let active = [
            ProcessInfo.processInfo.environment["EMWAVER_AGENT_ENDPOINT"] ?? "",
            ProcessInfo.processInfo.environment["CONTINUAL_AGENT_ENDPOINT"] ?? "",
            defaultEndpoint,
        ]
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .first { !$0.isEmpty } ?? ""

        return URL(string: active)
    }
}
