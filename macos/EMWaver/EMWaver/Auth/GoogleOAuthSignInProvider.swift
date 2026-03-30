import AuthenticationServices
import CryptoKit
import Foundation

/// Google OAuth (ASWebAuthenticationSession) -> Firebase ID token via Identity Toolkit.
final class GoogleOAuthSignInProvider: NSObject, GoogleSignInProviding {
    private struct TokenResponse: Decodable {
        let access_token: String
        let expires_in: Int?
        let id_token: String
        let refresh_token: String?
        let scope: String?
        let token_type: String?
    }

    private let firebase: FirebaseAuthService
    private let urlSession: URLSession

    init(firebase: FirebaseAuthService = FirebaseAuthService(), urlSession: URLSession = .shared) {
        self.firebase = firebase
        self.urlSession = urlSession
    }

    var isAvailable: Bool {
        !env("EMWAVER_GOOGLE_CLIENT_ID").isEmpty && !env("EMWAVER_FIREBASE_WEB_API_KEY").isEmpty
    }

    func signIn() async throws -> AuthAccount {
        let googleClientId = env("EMWAVER_GOOGLE_CLIENT_ID")
        let googleClientSecret = env("EMWAVER_GOOGLE_CLIENT_SECRET") // optional
        let firebaseWebApiKey = env("EMWAVER_FIREBASE_WEB_API_KEY")

        if googleClientId.isEmpty {
            throw AuthError.failed("Missing EMWAVER_GOOGLE_CLIENT_ID")
        }
        if firebaseWebApiKey.isEmpty {
            throw AuthError.failed("Missing EMWAVER_FIREBASE_WEB_API_KEY")
        }

        let redirectURI = env("EMWAVER_GOOGLE_REDIRECT_URI")
        let callbackScheme = callbackSchemeFromRedirectURI(redirectURI: redirectURI, googleClientId: googleClientId)

        let state = randomURLSafeString(bytes: 16)
        let nonce = randomURLSafeString(bytes: 16)

        // PKCE
        let codeVerifier = randomURLSafeString(bytes: 32)
        let codeChallenge = pkceChallenge(for: codeVerifier)

        // Auth URL
        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: googleClientId),
            URLQueryItem(name: "redirect_uri", value: effectiveRedirectURI(redirectURI: redirectURI, googleClientId: googleClientId)),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "nonce", value: nonce),
            URLQueryItem(name: "code_challenge", value: codeChallenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]

        let authURL = comps.url!

        let callbackURL = try await authenticate(url: authURL, callbackScheme: callbackScheme)
        guard let cbComps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
            throw AuthError.failed("Invalid callback URL")
        }

        let qs = Dictionary(uniqueKeysWithValues: (cbComps.queryItems ?? []).map { ($0.name, $0.value ?? "") })

        if let err = qs["error"], !err.isEmpty {
            throw AuthError.failed("Google sign-in failed: \(err)")
        }

        guard qs["state"] == state else {
            throw AuthError.failed("Google sign-in failed: state mismatch")
        }

        let code = qs["code"] ?? ""
        if code.isEmpty {
            throw AuthError.failed("Google sign-in failed: missing code")
        }

        // Exchange code -> tokens
        let tokens = try await exchangeCodeForTokens(
            code: code,
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            redirectURI: effectiveRedirectURI(redirectURI: redirectURI, googleClientId: googleClientId),
            codeVerifier: codeVerifier
        )

        // Tokens -> Firebase
        let fb = try await firebase.signInWithGoogle(
            firebaseWebApiKey: firebaseWebApiKey,
            googleIdToken: tokens.id_token,
            googleAccessToken: tokens.access_token
        )

        if fb.idToken.isEmpty {
            throw AuthError.failed("Firebase response missing idToken")
        }

        return AuthAccount(
            uid: fb.localId ?? "",
            email: fb.email,
            displayName: fb.displayName
        )
    }

    func signOut() async {
        // No persistent session yet (we can add refresh token storage later).
    }

    // MARK: - OAuth helpers

    private func exchangeCodeForTokens(code: String, clientId: String, clientSecret: String, redirectURI: String, codeVerifier: String) async throws -> TokenResponse {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        var parts: [String] = []
        func add(_ k: String, _ v: String) {
            let ek = k.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? k
            let ev = v.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? v
            parts.append("\(ek)=\(ev)")
        }

        add("code", code)
        add("client_id", clientId)
        if !clientSecret.isEmpty {
            add("client_secret", clientSecret)
        }
        add("redirect_uri", redirectURI)
        add("grant_type", "authorization_code")
        add("code_verifier", codeVerifier)

        req.httpBody = parts.joined(separator: "&").data(using: .utf8)

        let (data, res) = try await urlSession.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? -1

        if code < 200 || code >= 300 {
            let msg = String(data: data, encoding: .utf8) ?? ""
            throw AuthError.failed("Google token exchange failed: \(msg)")
        }

        return try JSONDecoder().decode(TokenResponse.self, from: data)
    }

    private func authenticate(url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
                if let error {
                    if (error as NSError).domain == ASWebAuthenticationSessionError.errorDomain,
                       (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        cont.resume(throwing: AuthError.cancelled)
                    } else {
                        cont.resume(throwing: AuthError.failed(error.localizedDescription))
                    }
                    return
                }
                guard let callbackURL else {
                    cont.resume(throwing: AuthError.failed("Missing callback URL"))
                    return
                }
                cont.resume(returning: callbackURL)
            }

            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            _ = session.start()
        }
    }

    private func env(_ key: String) -> String {
        (ProcessInfo.processInfo.environment[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func effectiveRedirectURI(redirectURI: String, googleClientId: String) -> String {
        if !redirectURI.isEmpty { return redirectURI }
        // Default to reverse client-id scheme redirect.
        return "com.googleusercontent.apps.\(reverseClientId(googleClientId)):/oauth2redirect"
    }

    private func callbackSchemeFromRedirectURI(redirectURI: String, googleClientId: String) -> String {
        let uri = effectiveRedirectURI(redirectURI: redirectURI, googleClientId: googleClientId)
        if let scheme = URL(string: uri)?.scheme {
            return scheme
        }
        return "com.googleusercontent.apps.\(reverseClientId(googleClientId))"
    }

    private func reverseClientId(_ googleClientId: String) -> String {
        // Input looks like: 123-abc.apps.googleusercontent.com
        // We want: 123-abc
        if let range = googleClientId.range(of: ".apps.googleusercontent.com") {
            return String(googleClientId[..<range.lowerBound])
        }
        return googleClientId
    }

    private func randomURLSafeString(bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func pkceChallenge(for verifier: String) -> String {
        let d = Data(verifier.utf8)
        let hashed = SHA256.hash(data: d)
        return Data(hashed).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension GoogleOAuthSignInProvider: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Best-effort: main app window.
        return NSApplication.shared.windows.first ?? ASPresentationAnchor()
    }
}
