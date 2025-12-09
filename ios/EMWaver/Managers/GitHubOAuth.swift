import Foundation
import AuthenticationServices

enum GitHubOAuthError: Error {
    case invalidURL
    case authenticationFailed(Error)
    case noCode
    case tokenExchangeFailed
}

class GitHubOAuth: NSObject {
    private let clientId = "Ov23lijxrW2l5TUQ5Bin"
    private let clientSecret = "5bec1297e8d460752d7ad0929cb9fb6642cc72b3"
    private let redirectUri = "emwaver://oauth/callback"
    private let scopes = ["public_repo", "read:user"]
    private let authUrl = "https://github.com/login/oauth/authorize"
    private let tokenUrl = "https://github.com/login/oauth/access_token"
    
    @MainActor
    func authenticate() async throws -> String {
        guard let url = getAuthorizationUrl() else {
            throw GitHubOAuthError.invalidURL
        }
        
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "emwaver") { callbackURL, error in
                if let error = error {
                    continuation.resume(throwing: GitHubOAuthError.authenticationFailed(error))
                    return
                }
                
                guard let callbackURL = callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: true),
                      let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
                    continuation.resume(throwing: GitHubOAuthError.noCode)
                    return
                }
                
                // Exchange code for token
                Task {
                    do {
                        let token = try await self.exchangeCodeForToken(code)
                        continuation.resume(returning: token)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
            
            // Presenting window
            session.presentationContextProvider = self
            session.start()
        }
    }
    
    private func getAuthorizationUrl() -> URL? {
        var components = URLComponents(string: authUrl)
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "scope", value: scopes.joined(separator: " "))
        ]
        return components?.url
    }
    
    private func exchangeCodeForToken(_ code: String) async throws -> String {
        guard let url = URL(string: tokenUrl) else {
            throw GitHubOAuthError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: String] = [
            "client_id": clientId,
            "client_secret": clientSecret,
            "code": code,
            "redirect_uri": redirectUri
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw GitHubOAuthError.tokenExchangeFailed
        }
        
        struct TokenResponse: Decodable {
            let access_token: String
        }
        
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)
        return tokenResponse.access_token
    }
}

extension GitHubOAuth: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // This finds the key window's root view controller's view or window
        // In SwiftUI, accessing the window is tricky, but this standard approach usually works
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }
}
