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

    private struct RefreshResponse: Decodable {
        let id_token: String
        let refresh_token: String
        let expires_in: String?
        let user_id: String?
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
        let escKey = firebaseWebApiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? firebaseWebApiKey
        let url = URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=\(escKey)")!

        let escIdToken = googleIdToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? googleIdToken
        let escAccessToken = googleAccessToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? googleAccessToken

        let postBody = "id_token=\(escIdToken)&access_token=\(escAccessToken)&providerId=google.com"

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

    func refresh(firebaseWebApiKey: String, refreshToken: String) async throws -> FirebaseSession {
        if firebaseWebApiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw AuthError.failed("Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)")
        }
        if refreshToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw AuthError.failed("Missing refresh token")
        }

        let escKey = firebaseWebApiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? firebaseWebApiKey
        let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(escKey)")!

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        func esc(_ s: String) -> String {
            s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
        }

        let body = "grant_type=refresh_token&refresh_token=\(esc(refreshToken))"
        req.httpBody = body.data(using: .utf8)

        let (data, res) = try await urlSession.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? -1

        if code < 200 || code >= 300 {
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.failed("Firebase token refresh failed: \(msg)")
        }

        let rr = try JSONDecoder().decode(RefreshResponse.self, from: data)

        return FirebaseSession(
            idToken: rr.id_token,
            refreshToken: rr.refresh_token,
            expiresIn: rr.expires_in,
            email: nil,
            displayName: nil,
            localId: rr.user_id
        )
    }
}
