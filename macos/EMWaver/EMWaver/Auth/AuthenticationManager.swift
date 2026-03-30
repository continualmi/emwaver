import Combine
import Foundation

#if canImport(AppKit)
import AppKit
#endif

@MainActor
final class AuthenticationManager: ObservableObject {
    @Published private(set) var account: AuthAccount?
    @Published private(set) var accessToken: String = ""
    @Published private(set) var hasSavedKey = false
    @Published private(set) var isValidatingKey = false
    @Published private(set) var didCompleteInitialRestore = false
    @Published var lastError: String?
    @Published var isSignInSheetPresented = false

    private let apiKeyAccount = "emwaver_api_key"
    private let profileAccount = "emwaver_api_key_profile"

    private struct StoredProfile: Codable {
        var uid: String
        var email: String?
        var displayName: String?
    }

    init() {
        Task { [weak self] in
            await self?.restoreCredentialIfPossible()
        }
    }

    var isSignedIn: Bool {
        hasSavedKey && account != nil
    }

    var userLabel: String {
        if let name = account?.displayName, !name.isEmpty {
            return name
        }
        if let email = account?.email, !email.isEmpty {
            return email
        }
        return hasSavedKey ? "EMWaver key" : "No key"
    }

    func saveApiKey(_ apiKey: String) async {
        guard !isValidatingKey else { return }
        lastError = nil
        isValidatingKey = true
        defer { isValidatingKey = false }

        do {
            let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw AuthError.failed("Enter an EMWaver API key.")
            }

            let validated = try await validateApiKey(trimmed)
            try KeychainStore.setString(trimmed, account: apiKeyAccount)
            try persistProfile(validated)
            accessToken = trimmed
            hasSavedKey = true
            account = validated
            isSignInSheetPresented = false
        } catch {
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func removeKey() async {
        clearStoredCredential(lastError: nil)
    }

    func openAccountManagement() {
        guard var base = FrontendUrl.resolve() else {
            lastError = "Missing EMWaver frontend URL"
            return
        }
        base.appendPathComponent("account")
#if canImport(AppKit)
        NSWorkspace.shared.open(base)
#endif
    }

    func waitForInitialRestore() async {
        while !didCompleteInitialRestore {
            await Task.yield()
        }
    }

    func handleUnauthorizedResponse(message: String = "Saved EMWaver key is no longer valid. Enter a new key to keep using account features.") {
        clearStoredCredential(lastError: message)
    }

    private func validateApiKey(_ apiKey: String) async throws -> AuthAccount {
        guard let base = BackendUrl.resolve() else {
            throw AuthError.failed("Missing EMWaver backend URL")
        }

        var url = base
        url.appendPathComponent("v1")
        url.appendPathComponent("auth")
        url.appendPathComponent("key")

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        do {
            let (data, res) = try await URLSession.shared.data(for: req)
            let http = (res as? HTTPURLResponse)?.statusCode ?? -1
            if http < 200 || http >= 300 {
                let msg = String(data: data, encoding: .utf8) ?? ""
                throw AuthError.failed(msg.isEmpty ? "API key validation failed (HTTP \(http))" : msg)
            }

            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let user = json?["user"] as? [String: Any]
            let uid = (user?["uid"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if uid.isEmpty {
                throw AuthError.failed("API key validation response was missing account identity.")
            }

            return AuthAccount(
                uid: uid,
                email: user?["email"] as? String,
                displayName: user?["name"] as? String
            )
        } catch let urlError as URLError {
            throw AuthError.failed("Could not reach \(url.absoluteString): \(urlError.localizedDescription)")
        }
    }

    private func persistProfile(_ profile: AuthAccount) throws {
        let stored = StoredProfile(uid: profile.uid, email: profile.email, displayName: profile.displayName)
        let profileData = try JSONEncoder().encode(stored)
        let profileStr = String(data: profileData, encoding: .utf8) ?? ""
        try KeychainStore.setString(profileStr, account: profileAccount)
    }

    private func restoreCredentialIfPossible() async {
        defer { didCompleteInitialRestore = true }

        do {
            guard let token = try KeychainStore.getString(account: apiKeyAccount), !token.isEmpty else {
                return
            }

            accessToken = token
            hasSavedKey = true

            var storedProfile: StoredProfile? = nil
            if let raw = try KeychainStore.getString(account: profileAccount) {
                if let data = raw.data(using: .utf8),
                   let decoded = try? JSONDecoder().decode(StoredProfile.self, from: data) {
                    storedProfile = decoded
                }
            }

            if let storedProfile, !storedProfile.uid.isEmpty {
                account = AuthAccount(
                    uid: storedProfile.uid,
                    email: storedProfile.email,
                    displayName: storedProfile.displayName
                )
            } else {
                account = nil
            }
        } catch {
            clearStoredCredential(lastError: nil)
        }
    }

    private func clearStoredCredential(lastError: String?) {
        KeychainStore.delete(account: apiKeyAccount)
        KeychainStore.delete(account: profileAccount)
        accessToken = ""
        hasSavedKey = false
        account = nil
        self.lastError = lastError
    }
}
