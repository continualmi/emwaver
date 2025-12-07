import Foundation

enum AgentServiceError: LocalizedError {
    case missingAccessToken
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in again to use the agent"
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
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

struct AgentMessage: Identifiable, Equatable {
    enum Role: String, Codable {
        case user
        case assistant
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

final class AgentService {
    static let shared = AgentService()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func fetchConversations(accessToken: String) async throws -> [AgentConversationSummary] {
        let request = try makeRequest(path: "llm/conversations", method: "GET", accessToken: accessToken)
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let items = json["conversations"] as? [[String: Any]]
            else {
                throw AgentServiceError.invalidResponse
            }

            return items.compactMap { item in
                guard let id = item["id"] as? String else { return nil }
                let title = (item["title"] as? String) ?? "Agent Chat"
                let updatedDate = Self.parse(timestamp: item["updated_at"]) ??
                    Self.parse(timestamp: item["created_at"]) ?? Date()
                return AgentConversationSummary(id: id, title: title, updatedAt: updatedDate)
            }
        } catch let error as AgentServiceError {
            throw error
        } catch {
            throw AgentServiceError.network(error)
        }
    }

    func fetchMessages(conversationId: String, accessToken: String, limit: Int = 50) async throws -> [AgentMessage] {
        let request = try makeRequest(
            path: "llm/conversations/\(conversationId)/messages",
            method: "GET",
            accessToken: accessToken,
            queryItems: [URLQueryItem(name: "limit", value: String(limit))]
        )

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let items = json["messages"] as? [[String: Any]]
            else {
                throw AgentServiceError.invalidResponse
            }

            return items.compactMap { item in
                guard let roleString = item["role"] as? String,
                      let role = AgentMessage.Role(rawValue: roleString)
                else {
                    return nil
                }

                var combined = ""
                if let contentArray = item["content"] as? [Any] {
                    for node in contentArray {
                        if let string = node as? String {
                            combined.append(string)
                        } else if let dict = node as? [String: Any],
                                  let text = dict["text"] as? String {
                            combined.append(text)
                        }
                    }
                }

                guard !combined.isEmpty else {
                    return nil
                }

                let createdAt = Self.parse(timestamp: item["created_at"]) ?? Date()
                return AgentMessage(role: role, content: combined.trimmingCharacters(in: .whitespacesAndNewlines), createdAt: createdAt)
            }
        } catch let error as AgentServiceError {
            throw error
        } catch {
            throw AgentServiceError.network(error)
        }
    }

    func createConversation(title: String, accessToken: String) async throws -> AgentConversationSummary {
        let payload: [String: Any] = ["title": title.isEmpty ? "Agent Chat" : title]
        let request = try makeRequest(path: "llm/conversations", method: "POST", accessToken: accessToken, body: payload)

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let conversation = json["conversation"] as? [String: Any],
                let id = conversation["id"] as? String
            else {
                throw AgentServiceError.invalidResponse
            }

            let title = (conversation["title"] as? String) ?? "Agent Chat"
            let updatedAt = Self.parse(timestamp: conversation["updated_at"]) ?? Date()
            return AgentConversationSummary(id: id, title: title, updatedAt: updatedAt)
        } catch let error as AgentServiceError {
            throw error
        } catch {
            throw AgentServiceError.network(error)
        }
    }

    func renameConversation(id: String, title: String, accessToken: String) async throws -> AgentConversationSummary {
        let payload: [String: Any] = ["title": title.isEmpty ? "Agent Chat" : title]
        let request = try makeRequest(path: "llm/conversations/\(id)", method: "PATCH", accessToken: accessToken, body: payload)

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let conversation = json["conversation"] as? [String: Any]
            else {
                throw AgentServiceError.invalidResponse
            }

            let updatedTitle = (conversation["title"] as? String) ?? title
            let updatedAt = Self.parse(timestamp: conversation["updated_at"]) ?? Date()
            return AgentConversationSummary(id: id, title: updatedTitle, updatedAt: updatedAt)
        } catch let error as AgentServiceError {
            throw error
        } catch {
            throw AgentServiceError.network(error)
        }
    }

    func deleteConversation(id: String, accessToken: String) async throws {
        let request = try makeRequest(path: "llm/conversations/\(id)", method: "DELETE", accessToken: accessToken)

        do {
            let (_, response) = try await session.data(for: request)
            try validate(response: response, data: nil)
        } catch let error as AgentServiceError {
            throw error
        } catch {
            throw AgentServiceError.network(error)
        }
    }

    func streamMessage(
        conversationId: String,
        message: String,
        accessToken: String
    ) -> AsyncThrowingStream<AgentStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let payload: [String: Any] = [
                "message": message,
                "stream": true
            ]

            let request: URLRequest
            do {
                request = try makeRequest(
                    path: "llm/conversations/\(conversationId)/messages",
                    method: "POST",
                    accessToken: accessToken,
                    body: payload
                )
            } catch {
                continuation.finish(throwing: error)
                return
            }

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
                        let message = AgentService.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
                        throw AgentServiceError.server(message: message)
                    }

                    var currentEvent: String?
                    var dataBuffer = ""

                    for try await line in bytes.lines {
                        try Task.checkCancellation()

                        if line.isEmpty {
                            if !dataBuffer.isEmpty {
                                handle(event: currentEvent, data: dataBuffer, continuation: continuation)
                            }
                            currentEvent = nil
                            dataBuffer = ""
                            continue
                        }

                        if line.hasPrefix("event:") {
                            currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            if !dataBuffer.isEmpty {
                                dataBuffer.append("\n")
                            }
                            dataBuffer.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                        }
                    }

                    if !dataBuffer.isEmpty {
                        handle(event: currentEvent, data: dataBuffer, continuation: continuation)
                    }

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

    private func makeRequest(
        path: String,
        method: String,
        accessToken: String,
        queryItems: [URLQueryItem]? = nil,
        body: [String: Any]? = nil
    ) throws -> URLRequest {
        guard !accessToken.isEmpty else {
            throw AgentServiceError.missingAccessToken
        }

        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let urlWithoutQuery = baseURL.appendingPathComponent(trimmed)

        guard var components = URLComponents(url: urlWithoutQuery, resolvingAgainstBaseURL: false) else {
            throw AgentServiceError.invalidResponse
        }

        components.queryItems = queryItems

        guard let url = components.url else {
            throw AgentServiceError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        if let body {
            guard JSONSerialization.isValidJSONObject(body) else {
                throw AgentServiceError.invalidResponse
            }

            let data = try JSONSerialization.data(withJSONObject: body)
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        return request
    }

    private func validate(response: URLResponse, data: Data?) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AgentServiceError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = AgentService.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
            throw AgentServiceError.server(message: message)
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

    private static func parse(timestamp value: Any?) -> Date? {
        guard let string = value as? String, !string.isEmpty else {
            return nil
        }

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = isoFormatter.date(from: string) {
            return date
        }

        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: string)
    }

    private func handle(
        event eventType: String?,
        data: String,
        continuation: AsyncThrowingStream<AgentStreamEvent, Error>.Continuation
    ) {
        guard !data.isEmpty else { return }

        let type = eventType ?? ""

        switch type {
        case "response.output_text.delta":
            if let delta = extractDelta(from: data) {
                continuation.yield(.delta(delta))
            }
        case "final":
            let text = extractFinalText(from: data)
            continuation.yield(.final(text))
        case "response.completed":
            continuation.yield(.completed)
        case "error", "response.error":
            let message = extractError(from: data) ?? "Streaming error"
            continuation.yield(.error(message))
        default:
            if let delta = extractDelta(from: data) {
                continuation.yield(.delta(delta))
            }
        }
    }

    private func extractDelta(from data: String) -> String? {
        guard
            let jsonData = data.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
        else { return nil }

        if let delta = json["delta"] as? String {
            return delta
        }
        if let deltaDict = json["delta"] as? [String: Any],
           let text = deltaDict["text"] as? String ?? deltaDict["value"] as? String {
            return text
        }
        if let array = json["delta"] as? [Any] {
            return array.compactMap { element -> String? in
                if let string = element as? String { return string }
                if let dict = element as? [String: Any] { return dict["text"] as? String }
                return nil
            }.joined()
        }
        if let contentArray = json["content"] as? [Any] {
            return contentArray.compactMap { element -> String? in
                if let string = element as? String { return string }
                if let dict = element as? [String: Any] { return dict["text"] as? String }
                return nil
            }.joined()
        }
        return json["text"] as? String
    }

    private func extractFinalText(from data: String) -> String {
        guard
            let jsonData = data.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
        else { return data }

        if let text = json["output_text"] as? String {
            return text
        }

        if let contentArray = json["content"] as? [Any] {
            return contentArray.compactMap { element -> String? in
                if let string = element as? String { return string }
                if let dict = element as? [String: Any] { return dict["text"] as? String }
                return nil
            }.joined()
        }

        return (json["message"] as? String) ?? data
    }

    private func extractError(from data: String) -> String? {
        guard
            let jsonData = data.data(using: .utf8),
            let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
        else { return nil }

        if let message = json["message"] as? String {
            return message
        }
        if let error = json["error"] as? String {
            return error
        }
        return nil
    }
}
