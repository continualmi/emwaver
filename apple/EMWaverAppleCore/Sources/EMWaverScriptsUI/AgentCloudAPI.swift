import Foundation

/// Minimal client for EMWaver Cloud Agent conversations, messages, and streaming chat.
struct AgentCloudAPI {
    enum StreamEvent {
        case delta(String)
        case done(message: MessageDTO, model: String?)
        case tool(name: String, kind: String, payload: Any)
        case error(String)
    }

    struct ConversationInfo: Codable {
        var id: String
        var title: String?
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

    func createConversation(baseURL: URL, token: String, title: String?) async throws -> ConversationInfo {
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
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, res) = try await urlSession.data(for: req)
        try Self.throwIfHTTPError(res, data)
        return try JSONDecoder().decode(CreateConversationResponse.self, from: data).conversation
    }

    func updateConversation(baseURL: URL, token: String, conversationId: String, title: String?) async throws -> ConversationInfo {
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

    func chatStream(
        baseURL: URL,
        token: String,
        conversationId: String,
        message: String,
        onEvent: @escaping (StreamEvent) async -> Void
    ) async throws {
        var url = baseURL
        url.appendPathComponent("v1/agent/chat/stream_tools")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "conversation_id": conversationId,
            "message": message,
        ])

        let (bytes, res) = try await urlSession.bytes(for: req)
        guard let http = res as? HTTPURLResponse else { return }
        if http.statusCode == 401 {
            throw NSError(domain: "AgentCloudAPI", code: 401, userInfo: [NSLocalizedDescriptionKey: "Unauthorized"])
        }
        guard (200...299).contains(http.statusCode) else {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
            }
            try Self.throwIfHTTPError(http, data)
            return
        }

        var block = ""
        for try await line in bytes.lines {
            if line.isEmpty {
                if let event = Self.parseSSEBlock(block) {
                    await onEvent(event)
                }
                block = ""
            } else {
                block += line
                block += "\n"
            }
        }

        if let event = Self.parseSSEBlock(block) {
            await onEvent(event)
        }
    }

    private static func throwIfHTTPError(_ res: URLResponse, _ data: Data) throws {
        guard let http = res as? HTTPURLResponse else { return }
        if http.statusCode >= 400 {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(domain: "AgentCloudAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: text.isEmpty ? "HTTP \(http.statusCode)" : text])
        }
    }

    private static func parseSSEBlock(_ block: String) -> StreamEvent? {
        let trimmed = block.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        var event = "message"
        var dataLines: [String] = []

        for lineSub in lines {
            let line = String(lineSub)
            if line.hasPrefix("event:") {
                event = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let value = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                dataLines.append(String(value))
            }
        }

        let raw = dataLines.joined(separator: "\n")
        guard !raw.isEmpty, let data = raw.data(using: .utf8) else { return nil }

        switch event {
        case "delta":
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return .delta(String(obj["text"] as? String ?? ""))
            }
        case "done":
            struct DoneBody: Decodable {
                let message: MessageDTO
                let model: String?
            }
            if let decoded = try? JSONDecoder().decode(DoneBody.self, from: data) {
                return .done(message: decoded.message, model: decoded.model)
            }
        case "tool":
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let name = String(obj["name"] as? String ?? "tool")
                let hasResult = obj["result"] != nil
                let payload = obj["result"] ?? obj["arguments"] ?? [:]
                return .tool(name: name, kind: hasResult ? "result" : "arguments", payload: payload)
            }
        case "error":
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return .error(String(obj["error"] as? String ?? "error"))
            }
        default:
            break
        }

        return nil
    }
}
