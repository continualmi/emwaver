/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

public protocol AgentChatService {
    func send(baseURL: URL, message: String) async throws -> String
}

public enum AgentChatServiceError: Error, LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case serverError(String)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Invalid backend URL"
        case .invalidResponse:
            return "Invalid response from backend"
        case .serverError(let message):
            return message
        }
    }
}

public struct AgentHTTPService: AgentChatService {
    public init() {}

    public func send(baseURL: URL, message: String) async throws -> String {
        let url = baseURL.appendingPathComponent("v1/agent/chat")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 30

        let body = RequestBody(message: message)
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AgentChatServiceError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode(ErrorBody.self, from: data), !decoded.error.isEmpty {
                throw AgentChatServiceError.serverError(decoded.error)
            }
            throw AgentChatServiceError.serverError("Backend returned HTTP \(http.statusCode)")
        }

        if let decoded = try? JSONDecoder().decode(ResponseBody.self, from: data) {
            let raw = decoded.reply ?? decoded.response ?? decoded.text ?? ""
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }

        // If backend returns plain text.
        if let text = String(data: data, encoding: .utf8) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }

        throw AgentChatServiceError.invalidResponse
    }

    private struct RequestBody: Codable {
        let message: String
    }

    private struct ErrorBody: Codable {
        let error: String
    }

    private struct ResponseBody: Codable {
        let reply: String?
        let response: String?
        let text: String?

        var textValue: String { reply ?? response ?? text ?? "" }

        private enum CodingKeys: String, CodingKey {
            case reply
            case response
            case text
        }
    }
}
