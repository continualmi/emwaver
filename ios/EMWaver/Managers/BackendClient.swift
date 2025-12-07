import Foundation

struct BackendLoginResult {
    let accessToken: String
    let refreshToken: String
    let userJSON: String?
    let entitlementJSON: String?
}

enum BackendClientError: LocalizedError {
    case invalidResponse
    case server(message: String)
    case network(Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .server(let message):
            return message
        case .network(let error):
            return error.localizedDescription
        }
    }
}

final class BackendClient {
    static let shared = BackendClient()

    private let session: URLSession
    private let baseURL: URL

    init(session: URLSession = .shared, baseURL: URL = AppConfig.backendBaseURL) {
        self.session = session
        self.baseURL = baseURL
    }

    func login(email: String, password: String) async throws -> BackendLoginResult {
        let payload: [String: Any] = [
            "email": email,
            "password": password
        ]
        return try await performAuth(path: "auth/login", payload: payload)
    }

    func register(
        email: String,
        username: String,
        password: String,
        firstName: String?,
        lastName: String?,
        accessCode: String?
    ) async throws -> BackendLoginResult {
        var payload: [String: Any] = [
            "email": email,
            "username": username,
            "password": password
        ]

        if let firstName, !firstName.isEmpty {
            payload["first_name"] = firstName
        }
        if let lastName, !lastName.isEmpty {
            payload["last_name"] = lastName
        }
        if let accessCode, !accessCode.isEmpty {
            payload["access_code"] = accessCode
        }

        return try await performAuth(path: "auth/register", payload: payload)
    }

    private func performAuth(path: String, payload: [String: Any]) async throws -> BackendLoginResult {
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw BackendClientError.invalidResponse
        }

        let data = try JSONSerialization.data(withJSONObject: payload, options: [])
        var request = URLRequest(url: url(for: path))
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (responseData, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw BackendClientError.invalidResponse
            }

            guard (200...299).contains(httpResponse.statusCode) else {
                let message = parseErrorMessage(from: responseData) ?? "Server returned status \(httpResponse.statusCode)"
                throw BackendClientError.server(message: message)
            }

            return try parseLoginResult(from: responseData)
        } catch let error as BackendClientError {
            throw error
        } catch {
            throw BackendClientError.network(error)
        }
    }

    private func url(for path: String) -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return baseURL.appendingPathComponent(trimmed)
    }

    private func parseLoginResult(from data: Data) throws -> BackendLoginResult {
        guard
            let jsonObject = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let accessToken = jsonObject["access_token"] as? String,
            let refreshToken = jsonObject["refresh_token"] as? String
        else {
            throw BackendClientError.invalidResponse
        }

        let userJSON = jsonString(from: jsonObject["user"])
        let entitlementJSON = jsonString(from: jsonObject["entitlement"])

        return BackendLoginResult(
            accessToken: accessToken,
            refreshToken: refreshToken,
            userJSON: userJSON,
            entitlementJSON: entitlementJSON
        )
    }

    private func jsonString(from value: Any?) -> String? {
        guard let value, !(value is NSNull) else { return nil }

        if let string = value as? String {
            return string
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: value, options: [])
            return String(data: data, encoding: .utf8)
        } catch {
            return nil
        }
    }

    private func parseErrorMessage(from data: Data?) -> String? {
        guard
            let data,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        if let message = object["message"] as? String {
            return message
        }
        if let error = object["error"] as? String {
            return error
        }
        return nil
    }
}
