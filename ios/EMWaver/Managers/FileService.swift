import Foundation

enum FileServiceError: LocalizedError {
    case missingAccessToken
    case invalidURL
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in again to manage scripts"
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

final class FileService {
    static let shared = FileService()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    // MARK: - Public API

    func listFiles(
        withExtension fileExtension: String?,
        includeContent: Bool,
        accessToken: String
    ) async throws -> [UserFileData] {
        let request = try makeRequest(
            path: "files",
            method: "GET",
            accessToken: accessToken,
            queryItems: queryItems(for: fileExtension, includeContent: includeContent)
        )

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let files = json["files"] as? [[String: Any]]
            else {
                throw FileServiceError.invalidResponse
            }

            return files.compactMap { Self.parseFileEntry($0) }
        } catch let error as FileServiceError {
            throw error
        } catch {
            throw FileServiceError.network(error)
        }
    }

    func getFile(id: String, accessToken: String) async throws -> UserFileData {
        let request = try makeRequest(
            path: "files/\(id)",
            method: "GET",
            accessToken: accessToken,
            queryItems: [URLQueryItem(name: "include", value: "content")]
        )

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let file = json["file"] as? [String: Any]
            else {
                throw FileServiceError.invalidResponse
            }

            guard let entry = Self.parseFileEntry(file) else {
                throw FileServiceError.invalidResponse
            }
            return entry
        } catch let error as FileServiceError {
            throw error
        } catch {
            throw FileServiceError.network(error)
        }
    }

    func createTextFile(name: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "name": name,
            "content": content
        ]

        let request = try makeRequest(
            path: "files",
            method: "POST",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func createBinaryFile(name: String, data: Data, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "name": name,
            "content_base64": data.base64EncodedString()
        ]

        let request = try makeRequest(
            path: "files",
            method: "POST",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func copyFile(sourceId: String, name: String, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "source_id": sourceId,
            "name": name
        ]

        let request = try makeRequest(
            path: "files",
            method: "POST",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func renameFile(id: String, name: String, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "name": name
        ]

        let request = try makeRequest(
            path: "files/\(id)",
            method: "PATCH",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func updateTextFile(id: String, etag: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "etag": etag,
            "content": content
        ]

        let request = try makeRequest(
            path: "files/\(id)",
            method: "PATCH",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func updateBinaryFile(id: String, etag: String, data: Data, accessToken: String) async throws -> UserFileMetadata {
        let payload: [String: Any] = [
            "etag": etag,
            "content_base64": data.base64EncodedString()
        ]

        let request = try makeRequest(
            path: "files/\(id)",
            method: "PATCH",
            accessToken: accessToken,
            body: payload
        )

        return try await sendMetadataRequest(request)
    }

    func deleteFile(id: String, etag: String?, accessToken: String) async throws {
        var payload: [String: Any] = [:]
        if let etag, !etag.isEmpty {
            payload["etag"] = etag
        }

        let request = try makeRequest(
            path: "files/\(id)",
            method: payload.isEmpty ? "DELETE" : "DELETE_BODY",
            accessToken: accessToken,
            body: payload.isEmpty ? nil : payload
        )

        do {
            let (_, response) = try await session.data(for: request)
            try validate(response: response, data: nil)
        } catch let error as FileServiceError {
            throw error
        } catch {
            throw FileServiceError.network(error)
        }
    }

    // MARK: - Helpers

    private func sendMetadataRequest(_ request: URLRequest) async throws -> UserFileMetadata {
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let file = json["file"] as? [String: Any]
            else {
                throw FileServiceError.invalidResponse
            }
            return UserFileMetadata(json: file)
        } catch let error as FileServiceError {
            throw error
        } catch {
            throw FileServiceError.network(error)
        }
    }

    private func makeRequest(
        path: String,
        method: String,
        accessToken: String,
        queryItems: [URLQueryItem]? = nil,
        body: [String: Any]? = nil
    ) throws -> URLRequest {
        guard !accessToken.isEmpty else {
            throw FileServiceError.missingAccessToken
        }

        let trimmedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let urlWithoutQuery = baseURL.appendingPathComponent(trimmedPath)

        guard var components = URLComponents(url: urlWithoutQuery, resolvingAgainstBaseURL: false) else {
            throw FileServiceError.invalidURL
        }

        components.queryItems = queryItems

        guard let url = components.url else {
            throw FileServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        if method == "DELETE_BODY" {
            request.httpMethod = "DELETE"
        } else {
            request.httpMethod = method
        }

        if let body {
            guard JSONSerialization.isValidJSONObject(body) else {
                throw FileServiceError.invalidResponse
            }
            let data = try JSONSerialization.data(withJSONObject: body)
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        return request
    }

    private func validate(response: URLResponse, data: Data?) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw FileServiceError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = Self.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
            throw FileServiceError.server(message: message)
        }
    }

    private func queryItems(for fileExtension: String?, includeContent: Bool) -> [URLQueryItem]? {
        var items: [URLQueryItem] = []
        if let fileExtension, !fileExtension.isEmpty {
            items.append(URLQueryItem(name: "extension", value: fileExtension))
        }
        if includeContent {
            items.append(URLQueryItem(name: "include", value: "content"))
        }
        return items.isEmpty ? nil : items
    }

    private static func parseFileEntry(_ json: [String: Any]) -> UserFileData? {
        let metadata = UserFileMetadata(json: json)
        guard !metadata.id.isEmpty else { return nil }

        let textContent = json["content"] as? String
        if let base64 = json["content_base64"] as? String, let data = Data(base64Encoded: base64) {
            return UserFileData(metadata: metadata, textContent: textContent, binaryContent: data)
        }
        return UserFileData(metadata: metadata, textContent: textContent, binaryContent: nil)
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
}
