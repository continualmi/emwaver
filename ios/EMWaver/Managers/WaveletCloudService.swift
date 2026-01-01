/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation

enum WaveletCloudServiceError: LocalizedError {
    case missingAccessToken
    case invalidURL
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in again to sync wavelets"
        case .invalidURL:
            return "Invalid wavelet endpoint"
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        }
    }
}

final class WaveletCloudService {
    static let shared = WaveletCloudService()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func uploadWavelet(
        name: String,
        content: String,
        metadataJSON: String?,
        accessToken: String
    ) async throws {
        guard !accessToken.isEmpty else {
            throw WaveletCloudServiceError.missingAccessToken
        }

        let url = baseURL.appendingPathComponent("wavelets")
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
            throw WaveletCloudServiceError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        do {
            let (_, response) = try await session.data(for: request)
            try validate(response: response)
        } catch let error as WaveletCloudServiceError {
            throw error
        } catch {
            throw WaveletCloudServiceError.network(error)
        }
    }

    private func validate(response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw WaveletCloudServiceError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw WaveletCloudServiceError.server(message: "Request failed: \(httpResponse.statusCode)")
        }
    }
}
