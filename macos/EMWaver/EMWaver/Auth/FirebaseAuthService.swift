import Foundation

final class FirebaseAuthService {
    struct FirebaseSession: Decodable {
        let idToken: String
        let refreshToken: String
        let expiresIn: String?
        let email: String?
        let displayName: String?
        let localId: String?
    }

    private let urlSession: URLSession

    init(urlSession: URLSession = .shared) {
        self.urlSession = urlSession
    }

    func signInWithGoogle(firebaseWebApiKey: String, googleIdToken: String, googleAccessToken: String) async throws -> FirebaseSession {
        if firebaseWebApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw AuthError.failed("Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)")
        }

        // Firebase Identity Toolkit: accounts:signInWithIdp
        // https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithIdp
        let url = URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=\(firebaseWebApiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? firebaseWebApiKey)")!

        let postBody = "id_token=\(googleIdToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? googleIdToken)" +
            "&access_token=\(googleAccessToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? googleAccessToken)" +
            "&providerId=google.com"

        let payload: [String: Any] = [
            "postBody": postBody,
            "requestUri": "http://localhost",
            "returnIdpCredential": true,
            "returnSecureToken": true,
        ]

        let body = try JSONSerialization.data(withJSONObject: payload)

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body

        let (data, res) = try await urlSession.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? -1

        if code < 200 || code >= 300 {
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.failed("Firebase signInWithIdp failed: \(msg)")
        }

        return try JSONDecoder().decode(FirebaseSession.self, from: data)
    }
}
