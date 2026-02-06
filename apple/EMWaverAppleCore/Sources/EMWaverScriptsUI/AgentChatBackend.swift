/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

enum AgentBackendError: Error, LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case serverError(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: return "Invalid backend URL"
        case .invalidResponse: return "Invalid response from backend"
        case .serverError(let msg): return msg
        case .unauthorized: return "Unauthorized"
        }
    }
}

public struct AgentConversationDTO: Decodable, Identifiable {
    public let id: String
    public let title: String?
    public let created_at_ms: Int64
    public let updated_at_ms: Int64
}

public struct AgentMessageDTO: Decodable, Identifiable {
    public let id: String
    public let role: String
    public let content: String
    public let created_at_ms: Int64
}

final class AgentBackendAPI {
    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func listConversations(baseURL: URL, idToken: String) async throws -> [AgentConversationDTO] {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !idToken.isEmpty {
            req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, res) = try await urlSession.data(for: req)
        struct Body: Decodable { let conversations: [AgentConversationDTO] }
        let body: Body = try decode(data: data, res: res)
        return body.conversations
    }

    func createConversation(baseURL: URL, idToken: String, title: String?) async throws -> AgentConversationDTO {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !idToken.isEmpty {
            req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = ["title": (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, res) = try await urlSession.data(for: req)

        struct Body: Decodable { let conversation: AgentConversationDTO }
        let body: Body = try decode(data: data, res: res)
        return body.conversation
    }

    func listMessages(baseURL: URL, idToken: String, conversationId: String) async throws -> [AgentMessageDTO] {
        var url = baseURL
        url.appendPathComponent("v1/agent/conversations")
        url.appendPathComponent(conversationId)
        url.appendPathComponent("messages")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if !idToken.isEmpty {
            req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, res) = try await urlSession.data(for: req)
        struct Body: Decodable { let messages: [AgentMessageDTO] }
        let body: Body = try decode(data: data, res: res)
        return body.messages
    }

    enum StreamEvent {
        case delta(String)
        case done(message: AgentMessageDTO, model: String?)
        case tool(String)
        case error(String)
    }

    func chatStream(
        baseURL: URL,
        idToken: String,
        conversationId: String,
        message: String,
        onEvent: @escaping (StreamEvent) -> Void
    ) async throws {
        var url = baseURL
        // Tool-capable endpoint (server-side tool loop).
        url.appendPathComponent("v1/agent/chat/stream_tools")

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !idToken.isEmpty {
            req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = [
            "conversation_id": conversationId,
            "message": message,
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (bytes, res) = try await urlSession.bytes(for: req)
        guard let http = res as? HTTPURLResponse else { throw AgentBackendError.invalidResponse }
        if http.statusCode == 401 { throw AgentBackendError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            // Drain body for error details.
            var data = Data()
            for try await b in bytes { data.append(b) }
            if let obj = try? JSONDecoder().decode([String: String].self, from: data), let err = obj["error"], !err.isEmpty {
                throw AgentBackendError.serverError(err)
            }
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw AgentBackendError.serverError(msg)
        }

        var buffer = ""
        for try await line in bytes.lines {
            if line.isEmpty {
                if let ev = Self.parseSSEBlock(buffer) {
                    onEvent(ev)
                }
                buffer = ""
            } else {
                buffer += line
                buffer += "\n"
            }
        }

        if let ev = Self.parseSSEBlock(buffer) {
            onEvent(ev)
        }
    }

    private static func parseSSEBlock(_ block: String) -> StreamEvent? {
        let trimmed = block.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }

        let lines = trimmed.split(separator: "\n", omittingEmptySubsequences: false)
        var ev = "message"
        var dataLines: [String] = []

        for lnSub in lines {
            let ln = String(lnSub)
            if ln.hasPrefix("event:") {
                ev = ln.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if ln.hasPrefix("data:") {
                let d = ln.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                dataLines.append(String(d))
            }
        }

        let dataRaw = dataLines.joined(separator: "\n")
        guard let data = dataRaw.data(using: .utf8), !dataRaw.isEmpty else { return nil }

        if ev == "delta" {
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return .delta(String(obj["text"] as? String ?? ""))
            }
        }

        if ev == "done" {
            struct DoneBody: Decodable { let message: AgentMessageDTO; let model: String? }
            if let decoded = try? JSONDecoder().decode(DoneBody.self, from: data) {
                return .done(message: decoded.message, model: decoded.model)
            }
        }

        if ev == "tool" {
            // We keep this as a simple, human-readable system line.
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let name = String(obj["name"] as? String ?? "tool")
                if let args = obj["arguments"] {
                    return .tool("[tool] \(name) args=\(args)")
                }
                if let res = obj["result"] {
                    return .tool("[tool] \(name) result=\(res)")
                }
                return .tool("[tool] \(name)")
            }
        }

        if ev == "error" {
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                return .error(String(obj["error"] as? String ?? "error"))
            }
        }

        return nil
    }

    private func decode<T: Decodable>(data: Data, res: URLResponse) throws -> T {
        guard let http = res as? HTTPURLResponse else { throw AgentBackendError.invalidResponse }
        if http.statusCode == 401 { throw AgentBackendError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let obj = try? JSONDecoder().decode([String: String].self, from: data), let err = obj["error"], !err.isEmpty {
                throw AgentBackendError.serverError(err)
            }
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw AgentBackendError.serverError(msg.isEmpty ? "HTTP \(http.statusCode)" : msg)
        }
        guard let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw AgentBackendError.invalidResponse
        }
        return decoded
    }
}
