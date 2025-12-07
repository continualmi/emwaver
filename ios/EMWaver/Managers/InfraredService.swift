import Foundation

enum InfraredServiceError: LocalizedError {
    case missingAccessToken
    case invalidURL
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in to use infrared tools"
        case .invalidURL:
            return "Invalid request URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        }
    }
}

struct InfraredDecodeResult: Identifiable {
    let id = UUID()
    let protocolName: String
    let parameters: [String: String]
    let raw: String
}

struct InfraredRenderResult {
    let protocolName: String
    let parameters: [String: Any]
    let format: String
    let signedRaw: String
}

final class InfraredService {
    static let shared = InfraredService()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func decodeSignedRaw(
        timings: String,
        strict: Bool,
        accessToken: String
    ) async throws -> [InfraredDecodeResult] {
        guard !timings.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return []
        }

        let payload: [String: Any] = [
            "input": [
                "format": "signed-raw",
                "data": timings.trimmingCharacters(in: .whitespacesAndNewlines)
            ],
            "strict": strict
        ]

        let request = try makeRequest(
            path: "infrared/decode",
            method: "POST",
            accessToken: accessToken,
            body: payload
        )

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                throw InfraredServiceError.invalidResponse
            }

            let resultsJSON = json["results"] as? [[String: Any]] ?? []
            return resultsJSON.map { item in
                let protocolName = (item["protocol"] as? String) ?? ""
                let parameters = InfraredService.normalizeParameters(item["parameters"] as? [String: Any])
                let raw = (item["raw"] as? String) ?? ""
                return InfraredDecodeResult(
                    protocolName: protocolName,
                    parameters: parameters,
                    raw: raw
                )
            }
        } catch let error as InfraredServiceError {
            throw error
        } catch {
            throw InfraredServiceError.network(error)
        }
    }

    func renderSignedRaw(
        protocolName: String,
        parameters: [String: Any],
        accessToken: String
    ) async throws -> InfraredRenderResult {
        let payload: [String: Any] = [
            "protocol": protocolName,
            "format": "signed-raw",
            "parameters": parameters
        ]

        let request = try makeRequest(
            path: "infrared/render",
            method: "POST",
            accessToken: accessToken,
            body: payload
        )

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let result = json["result"] as? [String: Any]
            else {
                throw InfraredServiceError.invalidResponse
            }

            let protocolName = (result["protocol"] as? String) ?? ""
            let parameters = result["parameters"] as? [String: Any] ?? [:]
            let format = (result["format"] as? String) ?? ""
            let renderedData = (result["data"] as? String) ?? ""

            return InfraredRenderResult(
                protocolName: protocolName,
                parameters: parameters,
                format: format,
                signedRaw: renderedData
            )
        } catch let error as InfraredServiceError {
            throw error
        } catch {
            throw InfraredServiceError.network(error)
        }
    }

    // MARK: - Helpers

    private func makeRequest(
        path: String,
        method: String,
        accessToken: String,
        body: [String: Any]? = nil
    ) throws -> URLRequest {
        guard !accessToken.isEmpty else {
            throw InfraredServiceError.missingAccessToken
        }

        let trimmedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let url = baseURL.appendingPathComponent(trimmedPath)

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        if let body {
            guard JSONSerialization.isValidJSONObject(body) else {
                throw InfraredServiceError.invalidResponse
            }
            let data = try JSONSerialization.data(withJSONObject: body)
            request.httpBody = data
            request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        return request
    }

    private func validate(response: URLResponse, data: Data?) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw InfraredServiceError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = InfraredService.parseErrorMessage(from: data)
                ?? "Request failed: \(httpResponse.statusCode)"
            throw InfraredServiceError.server(message: message)
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

    private static func normalizeParameters(_ raw: [String: Any]?) -> [String: String] {
        guard let raw else { return [:] }
        var normalized: [String: String] = [:]
        for (key, value) in raw {
            if let convertible = value as? CustomStringConvertible {
                normalized[key] = convertible.description
            } else {
                normalized[key] = String(describing: value)
            }
        }
        return normalized
    }
}
