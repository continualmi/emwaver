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
