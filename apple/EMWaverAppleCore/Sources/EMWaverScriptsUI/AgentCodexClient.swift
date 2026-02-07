/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

/// Minimal client for ChatGPT Codex responses API.
///
/// This runs locally in the host app. Tokens are stored in Keychain.
@MainActor
final class AgentCodexClient {
    private static let issuer = URL(string: "https://auth.openai.com")!
    private static let clientId = "app_EMoamEEZ73f0CkXaXp7hrann"
    private static let codexResponsesURL = URL(string: "https://chatgpt.com/backend-api/codex/responses")!

    private static let keychainService = "com.emwaver.agent.codex"
    private static let kcRefresh = "refresh_token"
    private static let kcAccess = "access_token"
    private static let kcExpiresAt = "expires_at_ms"
    private static let kcAccountId = "chatgpt_account_id"

    struct ToolSpec {
        let name: String
        let description: String
        let parameters: [String: Any]
    }

    func isConnected() -> Bool {
        (try? KeychainStore.get(service: Self.keychainService, account: Self.kcRefresh)) != nil
    }

    func disconnect() {
        try? KeychainStore.delete(service: Self.keychainService, account: Self.kcRefresh)
        try? KeychainStore.delete(service: Self.keychainService, account: Self.kcAccess)
        try? KeychainStore.delete(service: Self.keychainService, account: Self.kcExpiresAt)
        try? KeychainStore.delete(service: Self.keychainService, account: Self.kcAccountId)
    }

    func connectViaBrowserOAuth() async throws {
        let tokens = try await ChatGPTOAuth.loginBrowser()
        try store(tokens: tokens)
    }

    func getAccountId() -> String? {
        guard let d = try? KeychainStore.get(service: Self.keychainService, account: Self.kcAccountId),
              let s = String(data: d, encoding: .utf8), !s.isEmpty else { return nil }
        return s
    }

    /// Calls the ChatGPT Codex Responses endpoint using a Responses-style payload.
    ///
    /// Note: The Codex endpoint requires top-level `instructions`.
    func send(
        model: String,
        instructions: String,
        input: [[String: Any]],
        tools: [ToolSpec],
        sessionId: String?
    ) async throws -> [String: Any] {
        let access = try await validAccessToken()
        let accountId = getAccountId()

        // Caller provides Responses-style input items (see opencode convert-to-openai-responses-input.ts).

        var payload: [String: Any] = [
            "model": model,
            "instructions": instructions,
            "input": input,
            // Codex endpoint requirements.
            "store": false,
            "stream": true,
        ]
        if !tools.isEmpty {
            // Responses API tool format.
            payload["tools"] = tools.map { spec in
                [
                    "type": "function",
                    "name": spec.name,
                    "description": spec.description,
                    "parameters": spec.parameters,
                ]
            }
        }

        var req = URLRequest(url: Self.codexResponsesURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        req.setValue("emwaver", forHTTPHeaderField: "originator")
        req.setValue("emwaver-macos", forHTTPHeaderField: "User-Agent")
        if let sessionId, !sessionId.isEmpty {
            // Opencode uses this to keep Codex-side session context.
            req.setValue(sessionId, forHTTPHeaderField: "session_id")
        }
        if let accountId {
            req.setValue(accountId, forHTTPHeaderField: "ChatGPT-Account-Id")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)

        // Codex expects streaming (SSE). We don't surface partial deltas yet,
        // but we do consume the stream and return the final aggregated response.
        let (bytes, res) = try await URLSession.shared.bytes(for: req)
        guard let http = res as? HTTPURLResponse else { throw AgentBackendError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            // Best-effort read of body
            let body = try? await bytesToString(bytes)
            throw AgentBackendError.serverError(body ?? "HTTP \(http.statusCode)")
        }

        var lastJSON: [String: Any]?

        for try await line in bytes.lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("data:") else { continue }
            let payloadStr = trimmed.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            if payloadStr == "[DONE]" { break }
            guard let data = payloadStr.data(using: .utf8) else { continue }
            guard let obj = try? JSONSerialization.jsonObject(with: data) else { continue }

            if let dict = obj as? [String: Any] {
                // Some streams wrap the actual response under `response`.
                if let resp = dict["response"] as? [String: Any] {
                    lastJSON = resp
                } else {
                    lastJSON = dict
                }
            }
        }

        guard let lastJSON else {
            throw AgentBackendError.serverError("No response received")
        }
        return lastJSON
    }

    // MARK: - Token storage/refresh

    private func store(tokens: ChatGPTOAuth.Tokens) throws {
        guard !tokens.refreshToken.isEmpty else {
            throw AgentBackendError.serverError("Missing refresh token")
        }
        try KeychainStore.set(service: Self.keychainService, account: Self.kcRefresh, data: Data(tokens.refreshToken.utf8))
        try KeychainStore.set(service: Self.keychainService, account: Self.kcAccess, data: Data(tokens.accessToken.utf8))
        if let exp = tokens.expiresAtMs {
            try KeychainStore.set(service: Self.keychainService, account: Self.kcExpiresAt, data: Data(String(exp).utf8))
        }
        if let accountId = tokens.accountId, !accountId.isEmpty {
            try KeychainStore.set(service: Self.keychainService, account: Self.kcAccountId, data: Data(accountId.utf8))
        }
    }

    private func validAccessToken() async throws -> String {
        guard let refreshData = try KeychainStore.get(service: Self.keychainService, account: Self.kcRefresh),
              let refresh = String(data: refreshData, encoding: .utf8), !refresh.isEmpty else {
            throw AgentBackendError.serverError("ChatGPT not connected")
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let expiresAt: Int64? = {
            do {
                guard let data = try KeychainStore.get(service: Self.keychainService, account: Self.kcExpiresAt),
                      let s = String(data: data, encoding: .utf8),
                      let v = Int64(s) else { return nil }
                return v
            } catch {
                return nil
            }
        }()

        do {
            if let accessData = try KeychainStore.get(service: Self.keychainService, account: Self.kcAccess),
               let access = String(data: accessData, encoding: .utf8),
               !access.isEmpty,
               let expiresAt,
               expiresAt > (now + 3_000) {
                return access
            }
        } catch {
            // ignore
        }

        // Refresh
        let url = Self.issuer.appendingPathComponent("oauth/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let body = [
            "grant_type": "refresh_token",
            "refresh_token": refresh,
            "client_id": Self.clientId,
        ]
        req.httpBody = formEncode(body)

        let (data, res) = try await URLSession.shared.data(for: req)
        guard let http = res as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "refresh failed"
            throw AgentBackendError.serverError(msg)
        }

        let obj = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        let access = obj["access_token"] as? String ?? ""
        let newRefresh = (obj["refresh_token"] as? String) ?? refresh
        let expiresIn = obj["expires_in"] as? NSNumber

        guard !access.isEmpty else { throw AgentBackendError.serverError("Refresh returned no access token") }

        try KeychainStore.set(service: Self.keychainService, account: Self.kcAccess, data: Data(access.utf8))
        try KeychainStore.set(service: Self.keychainService, account: Self.kcRefresh, data: Data(newRefresh.utf8))
        if let exp = expiresIn {
            let expAt = now + exp.int64Value * 1000
            try KeychainStore.set(service: Self.keychainService, account: Self.kcExpiresAt, data: Data(String(expAt).utf8))
        }

        return access
    }

    private func bytesToString(_ bytes: URLSession.AsyncBytes) async throws -> String {
        var chunks: [String] = []
        for try await line in bytes.lines {
            chunks.append(line)
        }
        return chunks.joined(separator: "\n")
    }

    private func formEncode(_ dict: [String: String]) -> Data {
        let pairs = dict.map { key, value in
            "\(urlEncode(key))=\(urlEncode(value))"
        }.joined(separator: "&")
        return pairs.data(using: .utf8) ?? Data()
    }

    private func urlEncode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }
}
