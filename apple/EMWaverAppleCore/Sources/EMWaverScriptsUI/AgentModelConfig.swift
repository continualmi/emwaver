import Foundation

struct AgentModelConfig {
    let modelName: String
    let apiKey: String
    let baseURL: URL
    let timeoutInterval: TimeInterval

    static func current() -> AgentModelConfig? {
        let env = ProcessInfo.processInfo.environment

        let modelName = (env["MODEL_NAME"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let apiKey = (env["MODEL_API_KEY"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let base = (env["MODEL_BASE_URL"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let timeoutMs = (env["MODEL_REQUEST_TIMEOUT_MS"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        guard !modelName.isEmpty, !apiKey.isEmpty, !base.isEmpty, let baseURL = URL(string: base) else {
            return nil
        }

        let timeout = (Double(timeoutMs) ?? 60_000) / 1000.0
        return AgentModelConfig(
            modelName: modelName,
            apiKey: apiKey,
            baseURL: baseURL,
            timeoutInterval: max(5, timeout)
        )
    }

    var chatCompletionsURL: URL {
        let normalizedPath = baseURL.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if normalizedPath.hasSuffix("chat/completions") {
            return baseURL
        }

        var url = baseURL
        if !normalizedPath.hasSuffix("chat") {
            url.appendPathComponent("chat")
        }
        url.appendPathComponent("completions")
        return url
    }
}
