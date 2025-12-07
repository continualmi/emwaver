import Foundation

struct IRDBRemoteSummary: Identifiable, Equatable {
    let name: String
    let variantCount: Int

    var id: String { name }

    var displaySubtitle: String {
        variantCount == 1 ? "1 configuration" : "\(variantCount) configurations"
    }
}

struct IRDBImportProgress: Equatable {
    let processed: Int
    let total: Int

    var formatted: String {
        guard total > 0 else { return "Processing…" }
        return "\(processed) / \(total)"
    }
}

struct IRDBImportedWavelet {
    let name: String
    let content: String
    let metadataJSON: String?
}

enum IRDBServiceError: LocalizedError {
    case missingAccessToken
    case invalidURL
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .missingAccessToken:
            return "Please sign in again to import remotes"
        case .invalidURL:
            return "Invalid IRDB endpoint"
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        }
    }
}

final class IRDBService {
    static let shared = IRDBService()

    private let session: URLSession
    private let baseURL: URL
    private let pollInterval: UInt64 = 400_000_000 // 400ms

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func fetchBrands(accessToken: String) async throws -> [String] {
        let request = try makeRequest(path: "wavelets/irdb/brands", accessToken: accessToken)
        return try await sendListRequest(request, key: "brands")
    }

    func fetchRemotes(brand: String, accessToken: String) async throws -> [IRDBRemoteSummary] {
        let encodedBrand = brand.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? brand
        let path = "wavelets/irdb/remotes?brand=\(encodedBrand)"
        let request = try makeRequest(path: path, accessToken: accessToken)

        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw IRDBServiceError.invalidResponse
            }

            let entries = json["remotes"] as? [[String: Any]]
                ?? json["data"] as? [[String: Any]]
                ?? []

            return entries.compactMap { entry in
                guard let name = entry["name"] as? String else { return nil }
                let rawCount = entry["variant_count"]
                let count = Self.parseInt(rawCount) ?? 0
                return IRDBRemoteSummary(name: name, variantCount: count)
            }
        } catch let error as IRDBServiceError {
            throw error
        } catch {
            throw IRDBServiceError.network(error)
        }
    }

    func fetchVariants(brand: String, remote: String, accessToken: String) async throws -> [String] {
        let encodedBrand = brand.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? brand
        let encodedRemote = remote.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? remote
        let path = "wavelets/irdb/variants?brand=\(encodedBrand)&remote=\(encodedRemote)"
        let request = try makeRequest(path: path, accessToken: accessToken)
        return try await sendListRequest(request, key: "variants")
    }

    func importRemote(
        brand: String,
        remote: String,
        fileName: String,
        accessToken: String,
        progress: ((IRDBImportProgress) -> Void)? = nil
    ) async throws -> IRDBImportedWavelet {
        guard !accessToken.isEmpty else { throw IRDBServiceError.missingAccessToken }

        let url = baseURL.appendingPathComponent("wavelets/irdb/import")
        let payload: [String: Any] = [
            "brand": brand,
            "remote": remote,
            "file": fileName,
            "async": true
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw IRDBServiceError.invalidResponse
            }

            switch httpResponse.statusCode {
            case 200...299:
                return try Self.parseWavelet(from: data)
            case 202:
                let job = try Self.parseJob(from: data)
                if let progress {
                    await MainActor.run {
                        progress(IRDBImportProgress(processed: job.processed, total: job.total))
                    }
                }
                return try await pollJob(id: job.id, accessToken: accessToken, progress: progress)
            default:
                let message = Self.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
                throw IRDBServiceError.server(message: message)
            }
        } catch let error as IRDBServiceError {
            throw error
        } catch {
            throw IRDBServiceError.network(error)
        }
    }

    // MARK: - Private

    private func pollJob(
        id: String,
        accessToken: String,
        progress: ((IRDBImportProgress) -> Void)?
    ) async throws -> IRDBImportedWavelet {
        let path = "wavelets/irdb/import/\(id)"

        while true {
            try Task.checkCancellation()
            try await Task.sleep(nanoseconds: pollInterval)

            let request = try makeRequest(path: path, accessToken: accessToken)
            do {
                let (data, response) = try await session.data(for: request)
                try validate(response: response, data: data)

                let (done, processed, total, wavelet, errorMessage) = try Self.parseJobStatus(from: data)
                if let progress {
                    await MainActor.run {
                        progress(IRDBImportProgress(processed: processed, total: total))
                    }
                }

                if done {
                    if let wavelet {
                        return wavelet
                    }
                    throw IRDBServiceError.server(message: errorMessage ?? "Import failed")
                }
            } catch let error as IRDBServiceError {
                throw error
            } catch {
                throw IRDBServiceError.network(error)
            }
        }
    }

    private func makeRequest(path: String, accessToken: String) throws -> URLRequest {
        guard !accessToken.isEmpty else { throw IRDBServiceError.missingAccessToken }

        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard let url = URL(string: trimmed, relativeTo: baseURL) else {
            throw IRDBServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func sendListRequest(_ request: URLRequest, key: String) async throws -> [String] {
        do {
            let (data, response) = try await session.data(for: request)
            try validate(response: response, data: data)

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw IRDBServiceError.invalidResponse
            }

            let list = json[key] as? [Any] ?? json["data"] as? [Any] ?? []

            return list.compactMap { element in
                if let string = element as? String {
                    return string
                }
                return nil
            }
        } catch let error as IRDBServiceError {
            throw error
        } catch {
            throw IRDBServiceError.network(error)
        }
    }

    private func validate(response: URLResponse, data: Data?) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw IRDBServiceError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let message = Self.parseErrorMessage(from: data) ?? "Request failed: \(httpResponse.statusCode)"
            throw IRDBServiceError.server(message: message)
        }
    }

    private static func parseWavelet(from data: Data) throws -> IRDBImportedWavelet {
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let wavelet = json["wavelet"] as? [String: Any]
        else {
            throw IRDBServiceError.invalidResponse
        }
        return try waveletFromJSON(wavelet)
    }

    private static func parseJob(from data: Data) throws -> (id: String, processed: Int, total: Int) {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw IRDBServiceError.invalidResponse
        }

        let jobId = (json["jobId"] as? String)
            ?? (json["job_id"] as? String)
            ?? (json["id"] as? String)

        guard let resolvedId = jobId, !resolvedId.isEmpty else {
            throw IRDBServiceError.invalidResponse
        }

        let job = json["job"] as? [String: Any]
        let processed = parseInt(job?["processed"]) ?? 0
        let total = parseInt(job?["total"]) ?? 0
        return (resolvedId, processed, total)
    }

    private static func parseJobStatus(from data: Data) throws -> (done: Bool, processed: Int, total: Int, wavelet: IRDBImportedWavelet?, error: String?) {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw IRDBServiceError.invalidResponse
        }

        guard let job = json["job"] as? [String: Any] ?? json["data"] as? [String: Any] else {
            throw IRDBServiceError.invalidResponse
        }

        let doneValue = job["done"] ?? job["is_done"]
        let done = (doneValue as? Bool) ?? (doneValue as? NSNumber)?.boolValue ?? false
        let processed = parseInt(job["processed"]) ?? 0
        let total = parseInt(job["total"]) ?? 0

        if let waveletJSON = job["wavelet"] as? [String: Any] {
            let wavelet = try waveletFromJSON(waveletJSON)
            return (done, processed, total, wavelet, job["error"] as? String)
        }

        if let waveletJSON = job["result"] as? [String: Any] {
            let wavelet = try waveletFromJSON(waveletJSON)
            return (done, processed, total, wavelet, job["error"] as? String)
        }

        let error = job["error"] as? String ?? job["message"] as? String
        return (done, processed, total, nil, error)
    }

    private static func waveletFromJSON(_ json: [String: Any]) throws -> IRDBImportedWavelet {
        guard let name = json["name"] as? String, let content = json["content"] as? String else {
            throw IRDBServiceError.invalidResponse
        }
        var metadataJSON: String?
        if let metadata = json["metadata"], JSONSerialization.isValidJSONObject(metadata) {
            let data = try JSONSerialization.data(withJSONObject: metadata)
            metadataJSON = String(data: data, encoding: .utf8)
        }
        return IRDBImportedWavelet(name: name, content: content, metadataJSON: metadataJSON)
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

    private static func parseInt(_ value: Any?) -> Int? {
        if let intValue = value as? Int {
            return intValue
        }
        if let number = value as? NSNumber {
            return number.intValue
        }
        if let string = value as? String, let intValue = Int(string) {
            return intValue
        }
        return nil
    }
}
