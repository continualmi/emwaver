/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import os

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

public struct CloudUserFile: Codable, Equatable {
    public let name: String
    public let blobKey: String
    public let etag: String?
    public let sizeBytes: Int64?
    public let lastModified: String?
    public let contentType: String?
    public let mtimeMs: Int64?

    private enum CodingKeys: String, CodingKey {
        case name
        case blobKey = "blob_key"
        case etag
        case sizeBytes = "size_bytes"
        case lastModified = "last_modified"
        case contentType = "content_type"
        case mtimeMs = "mtime_ms"
    }
}

public final class CloudFilesAPI {
    private static let log = OSLog(subsystem: "com.emwaver", category: "CloudFilesAPI")
    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 30
        return URLSession(configuration: cfg)
    }()

    public init() {}

    public func listFiles(baseURL: URL, accessToken: String) async throws -> [CloudUserFile] {
        let url = baseURL.appendingPathComponent("v1/files")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        os_log("%{public}@", log: Self.log, type: .fault, "GET /v1/files -> \(http.statusCode)")
        try validate(http: http, data: data)

        struct Body: Codable { let files: [CloudUserFile] }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return decoded.files
    }

    public func uploadViaBackend(
        baseURL: URL,
        accessToken: String,
        name: String,
        contentType: String,
        bytes: Data,
        mtimeMs: Int64
    ) async throws -> CloudUserFile {
        let url = baseURL.appendingPathComponent("v1/files/upload")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let payload: [String: Any] = [
            "name": name,
            "content_type": contentType,
            "data_base64": bytes.base64EncodedString(),
            "mtime_ms": Int64(mtimeMs),
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        os_log("%{public}@", log: Self.log, type: .fault, "POST /v1/files/upload name=\(name) bytes=\(bytes.count) -> \(http.statusCode)")
        try validate(http: http, data: data)

        struct Body: Codable { let file: CloudUserFile }
        guard let decoded = try? JSONDecoder().decode(Body.self, from: data) else {
            throw CloudFilesAPIError.invalidResponse
        }
        return decoded.file
    }

    public func downloadContentViaBackend(baseURL: URL, accessToken: String, blobKey: String) async throws -> (data: Data, contentType: String?) {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/files/content"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "blob_key", value: blobKey)]
        guard let url = components?.url else { throw CloudFilesAPIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        os_log("%{public}@", log: Self.log, type: .fault, "GET /v1/files/content?blob_key=\(blobKey) -> \(http.statusCode) bytes=\(data.count)")
        try validate(http: http, data: data)

        let ct = http.value(forHTTPHeaderField: "Content-Type")
        return (data, ct)
    }

    public func deleteFile(baseURL: URL, accessToken: String, name: String) async throws {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/files"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "name", value: name)]
        guard let url = components?.url else { throw CloudFilesAPIError.invalidBaseURL }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await Self.session.data(for: request)
        let http = try requireHTTP(response)
        os_log("%{public}@", log: Self.log, type: .fault, "DELETE /v1/files?name=\(name) -> \(http.statusCode)")
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
