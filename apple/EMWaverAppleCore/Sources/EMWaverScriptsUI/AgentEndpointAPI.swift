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
    let universe: String
    let userInput: String
}

struct AgentUniverseCreateRequest: Encodable {
    let storedPrompt: String
    let displayName: String?
}

struct AgentUniverseCreateResponse: Decodable {
    let universe: String
    let userId: String?
}

struct AgentEndpointResponse: Decodable {
    let message: String?
    let assistantRaw: String?
    let code: String?
    let patch: String?
    let warnings: [String]?
}

final class AgentEndpointAPI {
    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func createUniverse(endpoint: URL, apiKey: String, storedPrompt: String, displayName: String?) async throws -> AgentUniverseCreateResponse {
        let createEndpoint = universeCreateEndpoint(from: endpoint)
        let payload = AgentUniverseCreateRequest(storedPrompt: storedPrompt, displayName: displayName)
        var req = URLRequest(url: createEndpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(payload)

        let data = try await send(req)
        guard let decoded = try? JSONDecoder().decode(AgentUniverseCreateResponse.self, from: data),
              !decoded.universe.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AgentEndpointError.invalidResponse
        }
        return decoded
    }

    func send(endpoint: URL, apiKey: String, request payload: AgentEndpointRequest) async throws -> AgentEndpointResponse {
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(payload)

        let data = try await send(req)
        guard let decoded = try? JSONDecoder().decode(AgentEndpointResponse.self, from: data) else {
            throw AgentEndpointError.invalidResponse
        }
        return decoded
    }

    private func send(_ req: URLRequest) async throws -> Data {
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
        return data
    }

    private func universeCreateEndpoint(from endpoint: URL) -> URL {
        let path = endpoint.path
        guard path.hasSuffix("/responses") else {
            return endpoint.deletingLastPathComponent().appendingPathComponent("universes")
        }
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.path = String(path.dropLast("/responses".count)) + "/universes"
        return components?.url ?? endpoint.deletingLastPathComponent().appendingPathComponent("universes")
    }
}
