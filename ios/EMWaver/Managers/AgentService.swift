import Foundation

enum AgentServiceError: LocalizedError {
    case invalidResponse
    case server(message: String)
    case network(Error)
    case missingApiKey

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        case .missingApiKey:
            return "Please set your API key in Agent Settings"
        }
    }
}

struct AgentConversationSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let updatedAt: Date

    init(id: String, title: String, updatedAt: Date) {
        self.id = id
        self.title = title.isEmpty ? "Agent Chat" : title
        self.updatedAt = updatedAt
    }
}

struct AgentMessage: Identifiable, Equatable, Codable {
    enum Role: String, Codable {
        case user
        case assistant
        case system
    }

    let id: UUID
    let role: Role
    var content: String
    let createdAt: Date

    init(id: UUID = UUID(), role: Role, content: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
    }
}

enum AgentStreamEvent {
    case delta(String)
    case final(String)
    case completed
    case error(String)
}

final class AgentService: ObservableObject {
    static let shared = AgentService()

    private let session: URLSession
    private let fileManager = FileManager.default
    private let conversationsDir: URL
    
    private static let defaultBaseURL = "https://openrouter.ai/api/v1"
    private static let defaultModel = "openai/gpt-oss-20b"
    private static let conversationsDirectoryName = "agent_conversations"
    private static let conversationsIndexFileName = "conversations_index.json"
    private static let systemPromptTemplate = """
        You are an AI assistant embedded in the EMWaver application. 
        EMWaver is a hardware hacking and security research tool with capabilities for RF analysis, 
        infrared control, sub-GHz communication, and signal manipulation. 
        Your primary role is to help users create wavelets—modular extensions that add new functionality to EMWaver. 
        Wavelets consist of a manifest and JavaScript code that interact with the device's hardware through the EMWaver Script SDK. 
        Provide clear, actionable guidance on wavelet development, hardware interaction, and EMWaver features.

        """

    init(session: URLSession = .shared) {
        self.session = session
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        conversationsDir = documentsPath.appendingPathComponent(Self.conversationsDirectoryName, isDirectory: true)
        try? fileManager.createDirectory(at: conversationsDir, withIntermediateDirectories: true)
    }

    // MARK: - Settings

    var baseURL: String {
        get {
            UserDefaults.standard.string(forKey: "agent_base_url") ?? Self.defaultBaseURL
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "agent_base_url")
        }
    }

    var apiKey: String {
        get {
            UserDefaults.standard.string(forKey: "agent_api_key") ?? ""
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "agent_api_key")
        }
    }

    var model: String {
        get {
            UserDefaults.standard.string(forKey: "agent_model") ?? Self.defaultModel
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "agent_model")
        }
    }

    var customInstructions: String {
        get {
            UserDefaults.standard.string(forKey: "agent_instructions") ?? ""
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "agent_instructions")
        }
    }

    // MARK: - Local Storage

    func loadConversations() -> [AgentConversationSummary] {
        let indexFile = conversationsDir.appendingPathComponent(Self.conversationsIndexFileName)
        guard fileManager.fileExists(atPath: indexFile.path),
              let data = try? Data(contentsOf: indexFile),
              let conversations = try? JSONDecoder().decode([AgentConversationSummary].self, from: data) else {
            return []
        }
        return conversations.sorted(by: { $0.updatedAt > $1.updatedAt })
    }

    func saveConversations(_ conversations: [AgentConversationSummary]) {
        let indexFile = conversationsDir.appendingPathComponent(Self.conversationsIndexFileName)
        let sorted = conversations.sorted(by: { $0.updatedAt > $1.updatedAt })
        if let data = try? JSONEncoder().encode(sorted) {
            try? data.write(to: indexFile)
        }
    }

    func loadMessages(conversationId: String) -> [AgentMessage] {
        let conversationFile = conversationsDir.appendingPathComponent("\(conversationId).json")
        guard fileManager.fileExists(atPath: conversationFile.path),
              let data = try? Data(contentsOf: conversationFile),
              let messages = try? JSONDecoder().decode([AgentMessage].self, from: data) else {
            return []
        }
        return messages
    }

    func saveMessages(conversationId: String, messages: [AgentMessage]) {
        let conversationFile = conversationsDir.appendingPathComponent("\(conversationId).json")
        if let data = try? JSONEncoder().encode(messages) {
            try? data.write(to: conversationFile)
        }
    }

    func deleteConversation(id: String) {
        let conversationFile = conversationsDir.appendingPathComponent("\(id).json")
        try? fileManager.removeItem(at: conversationFile)
    }

    // MARK: - OpenRouter API

    func streamMessage(
        conversationId: String,
        message: String,
        conversationHistory: [AgentMessage]
    ) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            guard !apiKey.isEmpty else {
                continuation.finish(throwing: AgentServiceError.missingApiKey)
                return
            }

            var baseURLString = baseURL
            if baseURLString.hasSuffix("/") {
                baseURLString = String(baseURLString.dropLast())
            }
            guard let url = URL(string: "\(baseURLString)/chat/completions") else {
                continuation.finish(throwing: AgentServiceError.invalidResponse)
                return
            }

            var systemPrompt = Self.systemPromptTemplate
            if !customInstructions.isEmpty {
                systemPrompt += "User Instructions:\n\(customInstructions)"
            }

            var messagesArray: [[String: Any]] = [
                ["role": "system", "content": systemPrompt]
            ]

            for msg in conversationHistory {
                messagesArray.append([
                    "role": msg.role.rawValue,
                    "content": msg.content
                ])
            }

            messagesArray.append([
                "role": "user",
                "content": message
            ])

            let payload: [String: Any] = [
                "model": model,
                "stream": true,
                "messages": messagesArray
            ]

            guard JSONSerialization.isValidJSONObject(payload),
                  let bodyData = try? JSONSerialization.data(withJSONObject: payload) else {
                continuation.finish(throwing: AgentServiceError.invalidResponse)
                return
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.addValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.addValue("application/json", forHTTPHeaderField: "Content-Type")
            request.addValue("https://emwaver.com", forHTTPHeaderField: "HTTP-Referer")
            request.addValue("EMWaver Agent", forHTTPHeaderField: "X-Title")
            request.httpBody = bodyData

            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)

                    guard let httpResponse = response as? HTTPURLResponse else {
                        throw AgentServiceError.invalidResponse
                    }

                    guard (200...299).contains(httpResponse.statusCode) else {
                        let data = try await bytes.reduce(into: Data()) { partialResult, byte in
                            partialResult.append(byte)
                        }
                        let message = Self.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
                        throw AgentServiceError.server(message: message)
                    }

                    var accumulated = ""

                    for try await line in bytes.lines {
                        try Task.checkCancellation()

                        if line.hasPrefix("data: ") {
                            let data = String(line.dropFirst(6))
                            if data == "[DONE]" {
                                break
                            }

                            guard let jsonData = data.data(using: .utf8),
                                  let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                                  let choices = json["choices"] as? [[String: Any]],
                                  let firstChoice = choices.first,
                                  let delta = firstChoice["delta"] as? [String: Any],
                                  let content = delta["content"] as? String else {
                                continue
                            }

                            accumulated.append(content)
                            continuation.yield(.delta(content))
                        }
                    }

                    continuation.yield(.final(accumulated))
                    continuation.yield(.completed)
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: AgentServiceError.network(CancellationError()))
                } catch let error as AgentServiceError {
                    continuation.finish(throwing: error)
                } catch {
                    continuation.finish(throwing: AgentServiceError.network(error))
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private static func parseErrorMessage(from data: Data?) -> String? {
        guard
            let data,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        if let message = json["message"] as? String {
            return message
        }
        if let error = json["error"] as? String {
            return error
        }
        return nil
    }
}
