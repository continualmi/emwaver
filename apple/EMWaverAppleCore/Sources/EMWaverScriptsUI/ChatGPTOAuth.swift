/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import Network
import CryptoKit
#if os(macOS)
import AppKit
#endif

/// Minimal ChatGPT/Codex OAuth helper (macOS-first).
///
/// Mirrors the flow used by anomalyco/opencode for "ChatGPT Plus/Pro" access:
/// - issuer: https://auth.openai.com
/// - client_id: app_EMoamEEZ73f0CkXaXp7hrann
/// - browser flow: /oauth/authorize + PKCE + localhost callback
/// - device flow: /api/accounts/deviceauth/* + /oauth/token
enum ChatGPTOAuth {
    static let clientId = "app_EMoamEEZ73f0CkXaXp7hrann"
    static let issuer = URL(string: "https://auth.openai.com")!
    static let oauthPort: UInt16 = 1455

    struct Tokens {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int?
        let idToken: String?
        let accountId: String?

        var expiresAtMs: Int64? {
            guard let expiresIn else { return nil }
            return Int64(Date().timeIntervalSince1970 * 1000) + Int64(expiresIn) * 1000
        }
    }

    // MARK: - Public API

    /// Browser-based login flow with a localhost callback.
    ///
    /// On macOS this opens the default browser.
    @MainActor
    static func loginBrowser() async throws -> Tokens {
        let pkce = try generatePKCE()
        let state = generateState()
        let redirectUri = "http://localhost:\(oauthPort)/auth/callback"

        let listener = try await LocalCallbackServer.start(port: oauthPort)
        defer { listener.stop() }

        let authorizeUrl = buildAuthorizeUrl(redirectUri: redirectUri, pkce: pkce, state: state)

        #if os(macOS)
        NSWorkspace.shared.open(authorizeUrl)
        #endif

        let callback = try await listener.waitForCallback(timeoutSeconds: 300)

        if let err = callback.error {
            throw NSError(domain: "ChatGPTOAuth", code: 1, userInfo: [NSLocalizedDescriptionKey: err])
        }
        guard let code = callback.code else {
            throw NSError(domain: "ChatGPTOAuth", code: 2, userInfo: [NSLocalizedDescriptionKey: "Missing authorization code"])
        }
        guard callback.state == state else {
            throw NSError(domain: "ChatGPTOAuth", code: 3, userInfo: [NSLocalizedDescriptionKey: "Invalid state"])
        }

        let tokenResp = try await exchangeCodeForTokens(code: code, redirectUri: redirectUri, pkce: pkce)
        return tokensFromResponse(tokenResp)
    }

    /// Headless / device-code style flow.
    ///
    /// Returns a URL the user should open and a user code they must enter.
    static func startDeviceLogin() async throws -> (verificationUrl: URL, userCode: String, deviceAuthId: String, intervalSeconds: Int) {
        let url = issuer.appendingPathComponent("api/accounts/deviceauth/usercode")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["client_id": clientId])

        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "ChatGPTOAuth", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to initiate device authorization"])
        }

        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let deviceAuthId = obj?["device_auth_id"] as? String
        let userCode = obj?["user_code"] as? String
        let intervalStr = obj?["interval"] as? String
        guard let deviceAuthId, let userCode else {
            throw NSError(domain: "ChatGPTOAuth", code: 11, userInfo: [NSLocalizedDescriptionKey: "Invalid device auth response"])
        }

        let intervalSeconds = max(Int(intervalStr ?? "5") ?? 5, 1)
        let verificationUrl = issuer.appendingPathComponent("codex/device")
        return (verificationUrl, userCode, deviceAuthId, intervalSeconds)
    }

    static func pollDeviceLogin(deviceAuthId: String, userCode: String, intervalSeconds: Int) async throws -> Tokens {
        while true {
            let url = issuer.appendingPathComponent("api/accounts/deviceauth/token")
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: [
                "device_auth_id": deviceAuthId,
                "user_code": userCode,
            ])

            let (data, res) = try await URLSession.shared.data(for: req)
            guard let http = res as? HTTPURLResponse else {
                throw NSError(domain: "ChatGPTOAuth", code: 20, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
            }

            if (200...299).contains(http.statusCode) {
                let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                guard let authorizationCode = obj?["authorization_code"] as? String,
                      let codeVerifier = obj?["code_verifier"] as? String else {
                    throw NSError(domain: "ChatGPTOAuth", code: 21, userInfo: [NSLocalizedDescriptionKey: "Invalid device token response"])
                }

                // Exchange authorization_code for tokens.
                let tokenResp = try await exchangeDeviceAuthorizationCodeForTokens(code: authorizationCode, codeVerifier: codeVerifier)
                return tokensFromResponse(tokenResp)
            }

            // opencode treats 403/404 as "still pending".
            if http.statusCode != 403 && http.statusCode != 404 {
                throw NSError(domain: "ChatGPTOAuth", code: 22, userInfo: [NSLocalizedDescriptionKey: "Device auth failed (HTTP \(http.statusCode))"])
            }

            try await Task.sleep(nanoseconds: UInt64(intervalSeconds) * 1_000_000_000)
        }
    }

    // MARK: - OAuth URL + Token exchange

    private struct PkceCodes { let verifier: String; let challenge: String }

    private static func buildAuthorizeUrl(redirectUri: String, pkce: PkceCodes, state: String) -> URL {
        var comps = URLComponents(url: issuer.appendingPathComponent("oauth/authorize"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "scope", value: "openid profile email offline_access"),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "id_token_add_organizations", value: "true"),
            URLQueryItem(name: "codex_cli_simplified_flow", value: "true"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "originator", value: "emwaver"),
        ]
        return comps.url!
    }

    private static func exchangeCodeForTokens(code: String, redirectUri: String, pkce: PkceCodes) async throws -> [String: Any] {
        let url = issuer.appendingPathComponent("oauth/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirectUri,
            "client_id": clientId,
            "code_verifier": pkce.verifier,
        ]
        req.httpBody = formEncode(body)

        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "ChatGPTOAuth", code: 30, userInfo: [NSLocalizedDescriptionKey: "Token exchange failed"])
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func exchangeDeviceAuthorizationCodeForTokens(code: String, codeVerifier: String) async throws -> [String: Any] {
        let url = issuer.appendingPathComponent("oauth/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": issuer.appendingPathComponent("deviceauth/callback").absoluteString,
            "client_id": clientId,
            "code_verifier": codeVerifier,
        ]
        req.httpBody = formEncode(body)

        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw NSError(domain: "ChatGPTOAuth", code: 31, userInfo: [NSLocalizedDescriptionKey: "Device token exchange failed"])
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    // MARK: - Helpers

    private static func tokensFromResponse(_ obj: [String: Any]) -> Tokens {
        let access = obj["access_token"] as? String ?? ""
        let refresh = obj["refresh_token"] as? String ?? ""
        let expiresIn = obj["expires_in"] as? Int
        let idToken = obj["id_token"] as? String

        let accountId = extractAccountId(idToken: idToken, accessToken: access)

        return Tokens(
            accessToken: access,
            refreshToken: refresh,
            expiresIn: expiresIn,
            idToken: idToken,
            accountId: accountId
        )
    }

    private static func extractAccountId(idToken: String?, accessToken: String) -> String? {
        if let idToken, let claims = parseJWTClaims(token: idToken) {
            if let id = claims["chatgpt_account_id"] as? String { return id }
            if let api = claims["https://api.openai.com/auth"] as? [String: Any], let id = api["chatgpt_account_id"] as? String { return id }
            if let orgs = claims["organizations"] as? [[String: Any]], let first = orgs.first, let id = first["id"] as? String { return id }
        }
        if let claims = parseJWTClaims(token: accessToken) {
            if let id = claims["chatgpt_account_id"] as? String { return id }
            if let api = claims["https://api.openai.com/auth"] as? [String: Any], let id = api["chatgpt_account_id"] as? String { return id }
            if let orgs = claims["organizations"] as? [[String: Any]], let first = orgs.first, let id = first["id"] as? String { return id }
        }
        return nil
    }

    private static func parseJWTClaims(token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        let payload = String(parts[1])
        guard let data = Data(base64URLEncoded: payload) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private static func generatePKCE() throws -> PkceCodes {
        let verifier = randomString(length: 43)
        guard let verifierData = verifier.data(using: .utf8) else { throw NSError(domain: "ChatGPTOAuth", code: 40) }
        let hash = sha256(verifierData)
        let challenge = base64UrlEncode(hash)
        return PkceCodes(verifier: verifier, challenge: challenge)
    }

    private static func generateState() -> String {
        base64UrlEncode(randomBytes(count: 32))
    }

    private static func randomBytes(count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes)
    }

    private static func randomString(length: Int) -> String {
        let chars = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let data = randomBytes(count: length)
        return data.map { chars[Int($0) % chars.count] }.map(String.init).joined()
    }

    private static func sha256(_ data: Data) -> Data {
        let digest = SHA256.hash(data: data)
        return Data(digest)
    }

    private static func base64UrlEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func formEncode(_ dict: [String: String]) -> Data {
        let pairs = dict.map { key, value in
            "\(urlEncode(key))=\(urlEncode(value))"
        }.joined(separator: "&")
        return pairs.data(using: .utf8) ?? Data()
    }

    private static func urlEncode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }
}

// MARK: - Local callback HTTP listener

private final class LocalCallbackServer {
    struct Callback {
        let code: String?
        let state: String?
        let error: String?
    }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "ChatGPTOAuth.LocalCallbackServer")

    private var callbackContinuation: CheckedContinuation<Callback, Error>?

    private init(listener: NWListener) {
        self.listener = listener
    }

    static func start(port: UInt16) async throws -> LocalCallbackServer {
        let params = NWParameters.tcp
        let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        let server = LocalCallbackServer(listener: listener)
        server.start()
        return server
    }

    func stop() {
        listener.cancel()
    }

    func waitForCallback(timeoutSeconds: TimeInterval) async throws -> Callback {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Callback, Error>) in
            self.callbackContinuation = cont
            self.queue.asyncAfter(deadline: .now() + timeoutSeconds) {
                if let c = self.callbackContinuation {
                    self.callbackContinuation = nil
                    c.resume(throwing: NSError(domain: "ChatGPTOAuth", code: 100, userInfo: [NSLocalizedDescriptionKey: "OAuth callback timeout"]))
                }
            }
        }
    }

    private func start() {
        listener.newConnectionHandler = { [weak self] conn in
            self?.handle(conn)
        }
        listener.start(queue: queue)
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, _, _ in
            guard let self else { return }
            guard let data, let req = String(data: data, encoding: .utf8) else {
                conn.cancel(); return
            }

            // Very small HTTP parser: read the first line: GET /auth/callback?code=... HTTP/1.1
            let firstLine = req.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? ""
            let parts = firstLine.split(separator: " ")
            let pathPart = parts.count >= 2 ? String(parts[1]) : "/"
            let comps = URLComponents(string: "http://localhost\(pathPart)")

            var callback = Callback(code: nil, state: nil, error: nil)
            if comps?.path == "/auth/callback" {
                let qp = comps?.queryItems ?? []
                callback = Callback(
                    code: qp.first(where: { $0.name == "code" })?.value,
                    state: qp.first(where: { $0.name == "state" })?.value,
                    error: qp.first(where: { $0.name == "error_description" })?.value ?? qp.first(where: { $0.name == "error" })?.value
                )
                respondHTML(conn: conn, status: 200, body: "<html><body>Authorization complete. You can close this window.</body></html>")
            } else {
                respondHTML(conn: conn, status: 404, body: "not found")
            }

            if let cont = self.callbackContinuation {
                self.callbackContinuation = nil
                cont.resume(returning: callback)
            }
        }
    }

    private func respondHTML(conn: NWConnection, status: Int, body: String) {
        let headers = "HTTP/1.1 \(status) OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n"
        let resp = headers + body
        conn.send(content: resp.data(using: .utf8), completion: .contentProcessed { _ in
            conn.cancel()
        })
    }
}

private extension Data {
    init?(base64URLEncoded s: String) {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let pad = t.count % 4
        if pad > 0 { t += String(repeating: "=", count: 4 - pad) }
        self.init(base64Encoded: t)
    }
}
