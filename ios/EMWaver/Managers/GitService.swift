import Foundation

class GitService: ObservableObject {
    static let shared = GitService()
    
    @Published var repositoryURL: String = ""
    @Published var accessToken: String = ""
    @Published var status: String = "Not configured"
    @Published var isLoading: Bool = false
    
    private let userDefaults = UserDefaults.standard
    private let repositoryURLKey = "git_repository_url"
    private let accessTokenKey = "git_access_token"
    
    private init() {
        loadSettings()
    }
    
    private func loadSettings() {
        repositoryURL = userDefaults.string(forKey: repositoryURLKey) ?? ""
        accessToken = userDefaults.string(forKey: accessTokenKey) ?? ""
        updateStatus()
    }
    
    func saveSettings() {
        userDefaults.set(repositoryURL, forKey: repositoryURLKey)
        userDefaults.set(accessToken, forKey: accessTokenKey)
        updateStatus()
    }
    
    private func updateStatus() {
        if repositoryURL.isEmpty || accessToken.isEmpty {
            status = "Not configured"
        } else {
            status = "Configured"
        }
    }
    
    func isConfigured() -> Bool {
        return !repositoryURL.isEmpty && !accessToken.isEmpty
    }
    
    func getRepositoryInfo() -> (owner: String, repo: String)? {
        guard let url = URL(string: repositoryURL),
              url.host == "github.com" || url.host == "www.github.com" else {
            return nil
        }
        
        let pathComponents = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        guard pathComponents.count >= 2 else {
            return nil
        }
        
        return (owner: pathComponents[0], repo: pathComponents[1].replacingOccurrences(of: ".git", with: ""))
    }
    
    func clone() async throws {
        guard isConfigured(), let (owner, repo) = getRepositoryInfo() else {
            throw GitError.notConfigured
        }
        
        isLoading = true
        defer { isLoading = false }
        
        let url = URL(string: "https://api.github.com/repos/\(owner)/\(repo)/contents")!
        var request = URLRequest(url: url)
        request.setValue("token \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GitError.invalidResponse
        }
        
        if httpResponse.statusCode == 401 {
            throw GitError.authenticationFailed
        }
        
        if httpResponse.statusCode != 200 {
            throw GitError.apiError("HTTP \(httpResponse.statusCode)")
        }
        
        status = "Cloned successfully"
    }
    
    func pull() async throws {
        guard isConfigured(), let (owner, repo) = getRepositoryInfo() else {
            throw GitError.notConfigured
        }
        
        isLoading = true
        defer { isLoading = false }
        
        let url = URL(string: "https://api.github.com/repos/\(owner)/\(repo)/contents")!
        var request = URLRequest(url: url)
        request.setValue("token \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GitError.invalidResponse
        }
        
        if httpResponse.statusCode == 401 {
            throw GitError.authenticationFailed
        }
        
        if httpResponse.statusCode != 200 {
            throw GitError.apiError("HTTP \(httpResponse.statusCode)")
        }
        
        status = "Pulled successfully"
    }
    
    func push() async throws {
        guard isConfigured() else {
            throw GitError.notConfigured
        }
        
        isLoading = true
        defer { isLoading = false }
        
        status = "Push not yet implemented"
        throw GitError.notImplemented("Push functionality requires local Git repository")
    }
}

enum GitError: LocalizedError {
    case notConfigured
    case authenticationFailed
    case invalidResponse
    case apiError(String)
    case notImplemented(String)
    
    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "GitHub repository and access token must be configured"
        case .authenticationFailed:
            return "Authentication failed. Please check your access token."
        case .invalidResponse:
            return "Invalid response from GitHub API"
        case .apiError(let message):
            return "GitHub API error: \(message)"
        case .notImplemented(let message):
            return "Not implemented: \(message)"
        }
    }
}
