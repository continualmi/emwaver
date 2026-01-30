/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import Foundation

enum ScriptCloudServiceError: LocalizedError {
    case missingAccessToken
    case invalidURL
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in again to sync scripts"
        case .invalidURL:
            return "Invalid script endpoint"
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        }
    }
}

final class ScriptCloudService {
    static let shared = ScriptCloudService()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func uploadScript(
        name: String,
        content: String,
        metadataJSON: String?,
        accessToken: String
    ) async throws {
        guard !accessToken.isEmpty else {
            throw ScriptCloudServiceError.missingAccessToken
        }

        let url = baseURL.appendingPathComponent("scripts")
        var payload: [String: Any] = [
            "name": name,
            "content": content
        ]

        if let metadataJSON,
           let data = metadataJSON.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) {
            payload["metadata"] = object
        }

        guard JSONSerialization.isValidJSONObject(payload) else {
            throw ScriptCloudServiceError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        do {
            let (_, response) = try await session.data(for: request)
            try validate(response: response)
        } catch let error as ScriptCloudServiceError {
            throw error
        } catch {
            throw ScriptCloudServiceError.network(error)
        }
    }

    private func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ScriptCloudServiceError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw ScriptCloudServiceError.server(message: "Request failed: \(httpResponse.statusCode)")
        }
    }
}
