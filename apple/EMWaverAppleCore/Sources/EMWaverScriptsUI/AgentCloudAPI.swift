import Foundation

/// Minimal client for persisted Agent conversations/messages in EMWaver Cloud.
///
/// NOTE: We keep this lightweight on purpose: the macOS app can still run inference locally,
/// but uses these endpoints to store/restore chat history.
struct AgentCloudAPI {
    struct ConversationInfo: Codable {
        var id: String
        var title: String?
        var agent_type: String?
        var created_at_ms: Int
        var updated_at_ms: Int
    }

    struct ConversationsResponse: Codable {
        var conversations: [ConversationInfo]
    }

    struct CreateConversationResponse: Codable {
        var conversation: ConversationInfo
    }

    struct MessageDTO: Codable {
        var id: String
        var role: String
        var content: String
        var created_at_ms: Int
    }

    struct MessagesResponse: Codable {
        var messages: [MessageDTO]
    }

    struct AppendMessageResponse: Codable {
        var message: MessageDTO
    }

    let urlSession: URLSession = .shared

    func listConversations(baseURL: URL, token: String) async throws -> [ConversationInfo] {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(ConversationsResponse.self, from: data).conversations
    }

    func createConversation(baseURL: URL, token: String, title: String?, agentType: String?) async throws -> ConversationInfo {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var payload: [String: Any] = [:]
        if let t = title, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["title"] = t
        }
        if let type = agentType, !type.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["agent_type"] = type
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(CreateConversationResponse.self, from: data).conversation
    }

    func updateConversation(baseURL: URL, token: String, conversationId: String, title: String?, agentType: String?) async throws -> ConversationInfo {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")
        url.appendPathComponent(conversationId)

        var req = URLRequest(url: url)
        req.httpMethod = "PATCH"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var payload: [String: Any] = [:]
        if let title {
            payload["title"] = title
        }
        if let agentType {
            payload["agent_type"] = agentType
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(CreateConversationResponse.self, from: data).conversation
    }

    func listMessages(baseURL: URL, token: String, conversationId: String) async throws -> [MessageDTO] {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")
        url.appendPathComponent(conversationId)
        url.appendPathComponent("messages")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(MessagesResponse.self, from: data).messages
    }

    func appendMessage(baseURL: URL, token: String, conversationId: String, role: String, content: String) async throws -> MessageDTO {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")
        url.appendPathComponent(conversationId)
        url.appendPathComponent("messages")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "role": role,
            "content": content,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(AppendMessageResponse.self, from: data).message
    }

    func deleteConversation(baseURL: URL, token: String, conversationId: String) async throws {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")
        url.appendPathComponent(conversationId)

        var req = URLRequest(url: url)
        req.httpMethod = "DELETE"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        _ = data
    }

    private static func throwIfHTTPError(_ res: URLResponse, _ data: Data) throws {
        guard let http = res as? HTTPURLResponse else { return }
        if http.statusCode >= 400 {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "AgentCloudAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "HTTP \(http.statusCode)" : text])
        }
    }
}
