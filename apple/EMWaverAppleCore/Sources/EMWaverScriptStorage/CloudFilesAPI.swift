/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

public enum CloudFilesAPIError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case serverError(Int, String)

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Invalid backend URL"
        case .invalidResponse:
            return "Invalid response from backend"
        case .serverError(let code, let message):
            return message.isEmpty ? "Backend returned HTTP \(code)" : message
        }
    }
}

public struct CloudFileMetadata: Codable, Equatable {
    public struct Metadata: Codable, Equatable {
        public let id: String
        public let name: String
        public let extensionValue: String?
        public let fileExtension: String?
        public let kind: String
        public let etag: String?
        public let sizeBytes: Int64?
        public let contentType: String?

        private enum CodingKeys: String, CodingKey {
            case id
            case name
            case extensionValue = "extension"
            case fileExtension = "file_extension"
            case kind
            case etag
            case sizeBytes = "size_bytes"
            case contentType = "content_type"
        }
    }

    public let metadata: Metadata
}

public final class CloudFilesAPI {
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 30
        return URLSession(configuration: cfg)
    }()

    public init() {}

    public func listFiles(baseURL: URL, accessToken: String, kind: String, ext: String) async throws -> [CloudFileMetadata] {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/files"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "kind", value: kind),
            URLQueryItem(name: "ext", value: ext),
        ]
        guard let url = components?.url else { throw CloudFilesAPIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        try validate(http: http, data: data)

        struct Body: Codable { let files: [CloudFileMetadata] }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return decoded.files
    }

    public func initUpload(
        baseURL: URL,
        accessToken: String,
        kind: String,
        name: String,
        contentType: String,
        sizeBytes: Int64
    ) async throws -> (file: CloudFileMetadata, uploadURL: URL) {
        let url = baseURL.appendingPathComponent("v1/files/init-upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = [
            "kind": kind,
            "name": name,
            "content_type": contentType,
            "size_bytes": sizeBytes,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        try validate(http: http, data: data)

        struct Body: Codable {
            let file: CloudFileMetadata
            let uploadUrl: String
            private enum CodingKeys: String, CodingKey {
                case file
                case uploadUrl = "upload_url"
            }
        }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data), let url = URL(string: decoded.uploadUrl) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return (decoded.file, url)
    }

    public func commitUpload(baseURL: URL, accessToken: String, fileId: String, expectedEtag: String, sizeBytes: Int64?) async throws -> CloudFileMetadata {
        let url = baseURL.appendingPathComponent("v1/files/\(fileId)/commit-upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        var payload: [String: Any] = ["etag": expectedEtag]
        if let sizeBytes {
            payload["size_bytes"] = sizeBytes
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        try validate(http: http, data: data)

        guard let decoded = try? JSONDecoder().decode(CloudFileMetadata.self, from: data) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return decoded
    }

    public func downloadURL(baseURL: URL, accessToken: String, fileId: String) async throws -> URL {
        let url = baseURL.appendingPathComponent("v1/files/\(fileId)/download")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        try validate(http: http, data: data)

        struct Body: Codable {
            let downloadUrl: String
            private enum CodingKeys: String, CodingKey { case downloadUrl = "download_url" }
        }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data), let url = URL(string: decoded.downloadUrl) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return url
    }

    public func deleteFile(baseURL: URL, accessToken: String, fileId: String, etag: String) async throws {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/files/\(fileId)"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "etag", value: etag)]
        guard let url = components?.url else { throw CloudFilesAPIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        try validate(http: http, data: data)

        _ = data
    }

    // MARK: - Helpers

    private func requireHTTP(_ response: URLResponse) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw CloudFilesAPIError.invalidResponse }
        return http
    }

    private func validate(http: HTTPURLResponse, data: Data) throws {
        guard (200...299).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode([String: String].self, from: data), let msg = decoded["error"] {
                throw CloudFilesAPIError.serverError(http.statusCode, msg)
            }
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw CloudFilesAPIError.serverError(http.statusCode, msg.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
}
