/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

enum AgentEndpointError: Error, LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case serverError(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL: return "Invalid Agent endpoint URL"
        case .invalidResponse: return "Invalid response from Agent endpoint"
        case .serverError(let msg): return msg
        case .unauthorized: return "Unauthorized"
        }
    }
}

struct AgentEndpointRequest: Encodable {
    struct ScriptContext: Encodable {
        let name: String
        let source: String
    }

    struct RuntimeContext: Encodable {
        let error: String?
        let logs: [String]?
    }

    struct HardwareContext: Encodable {
        let boardType: String?
        let modules: [String]?
    }

    let mode: String
    let prompt: String
    let script: ScriptContext?
    let runtime: RuntimeContext?
    let hardware: HardwareContext?
}

struct AgentEndpointResponse: Decodable {
    let message: String?
    let code: String?
    let patch: String?
    let warnings: [String]?
}

final class AgentEndpointAPI {
    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func send(endpoint: URL, apiKey: String, request payload: AgentEndpointRequest) async throws -> AgentEndpointResponse {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(payload)

        let (data, res) = try await urlSession.data(for: req)
        guard let http = res as? HTTPURLResponse else { throw AgentEndpointError.invalidResponse }
        if http.statusCode == 401 { throw AgentEndpointError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            if let obj = try? JSONDecoder().decode([String: String].self, from: data) {
                let message = obj["message"] ?? obj["error"]
                if let message, !message.isEmpty {
                    throw AgentEndpointError.serverError(message)
                }
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            throw AgentEndpointError.serverError(text.isEmpty ? "HTTP \(http.statusCode)" : text)
        }

        guard let decoded = try? JSONDecoder().decode(AgentEndpointResponse.self, from: data) else {
            throw AgentEndpointError.invalidResponse
        }
        return decoded
    }
}
