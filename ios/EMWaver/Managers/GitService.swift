/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import Combine

class GitService: ObservableObject {
    static let shared = GitService()
    
    // Auth State
    @Published var isAuthenticated: Bool = false
    @Published var currentUser: GitHubUser?
    @Published var accessToken: String = "" {
        didSet {
            if !accessToken.isEmpty {
                apiClient = GitHubApiClient(token: accessToken)
                isAuthenticated = true
                saveSettings()
            } else {
                isAuthenticated = false
                currentUser = nil
                repositories = []
            }
        }
    }
    
    // Repository State
    @Published var repositories: [GitHubRepository] = []
    @Published var selectedRepo: GitHubRepository?
    @Published var currentPath: String = ""
    @Published var fileTree: [GitHubContent] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?
    @Published var successMessage: String?
    
    // Managers
    private var apiClient: GitHubApiClient?
    private let oauth = GitHubOAuth()
    private let fileService = FileService.shared
    
    private let userDefaults = UserDefaults.standard
    private let accessTokenKey = "git_access_token"
    private let selectedRepoOwnerKey = "git_selected_repo_owner"
    private let selectedRepoNameKey = "git_selected_repo_name"
    private let patKey = "git_pat"
    
    private init() {
        loadSettings()
    }
    
    func loadSettings() {
        if let token = userDefaults.string(forKey: accessTokenKey), !token.isEmpty {
            self.accessToken = token
            // apiClient init handled by didSet
            
            // Restore selected repo if possible
            let owner = userDefaults.string(forKey: selectedRepoOwnerKey)
            let name = userDefaults.string(forKey: selectedRepoNameKey)
            if let owner = owner, let name = name {
                // We create a temporary repo object so the UI knows we have one selected
                // It will be fully populated when we list repos or get details
                self.selectedRepo = GitHubRepository(
                    id: nil,
                    name: name,
                    fullName: "\(owner)/\(name)",
                    owner: GitHubUser(login: owner, id: nil, avatarUrl: nil),
                    isPrivate: false // Assumption until loaded
                )
            }
            
            Task {
                await loadUser()
                if selectedRepo != nil {
                   await refreshFileTree()
                }
            }
        }
    }
    
    func saveSettings() {
        userDefaults.set(accessToken, forKey: accessTokenKey)
        if let repo = selectedRepo, let owner = repo.owner?.login {
            userDefaults.set(owner, forKey: selectedRepoOwnerKey)
            userDefaults.set(repo.name, forKey: selectedRepoNameKey)
        }
    }
    
    // MARK: - Authentication
    
    func loginWithOAuth() async {
        await MainActor.run { isLoading = true }
        defer { Task { await MainActor.run { isLoading = false } } }
        
        do {
            let token = try await oauth.authenticate()
            await MainActor.run {
                self.accessToken = token
                self.saveSettings()
            }
            await loadUser()
        } catch {
            await MainActor.run { errorMessage = error.localizedDescription }
        }
    }
    
    func setPAT(_ pat: String) {
        self.accessToken = pat
        saveSettings()
        Task { 
            await loadUser()
            await listRepositories()
        }
    }
    
    func logout() {
        accessToken = ""
        currentUser = nil
        repositories = []
        selectedRepo = nil
        fileTree = []
        currentPath = ""
        userDefaults.removeObject(forKey: accessTokenKey)
        userDefaults.removeObject(forKey: selectedRepoOwnerKey)
        userDefaults.removeObject(forKey: selectedRepoNameKey)
    }
    
    func loadUser() async {
        guard let client = apiClient else { return }
        do {
            let user = try await client.getUser()
            await MainActor.run { self.currentUser = user }
        } catch {
            await MainActor.run { errorMessage = "Failed to load user: \(error.localizedDescription)" }
        }
    }
    
    // MARK: - Repositories
    
    func listRepositories() async {
        guard let client = apiClient else { return }
        await MainActor.run { isLoading = true }
        
        do {
            let repos = try await client.listRepositories()
            await MainActor.run {
                self.repositories = repos
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to list repos: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }
    
    func selectRepository(_ repo: GitHubRepository) {
        self.selectedRepo = repo
        self.currentPath = ""
        saveSettings()
        Task {
            await refreshFileTree()
        }
    }
    
    func createRepository(name: String, description: String, isPrivate: Bool) async {
        guard let client = apiClient else { return }
        await MainActor.run { isLoading = true }
        
        do {
            let repo = try await client.createRepository(name: name, description: description, isPrivate: isPrivate)
            await MainActor.run {
                self.selectedRepo = repo
                self.saveSettings()
                self.successMessage = "Repository created"
                self.isLoading = false
            }
            // Commit all local files
            await commitAllLocalFiles()
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to create repo: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }
    
    // MARK: - File Navigation
    
    func refreshFileTree() async {
        guard let client = apiClient, let repo = selectedRepo, let owner = repo.owner?.login else { return }
        await MainActor.run { isLoading = true }
        
        do {
            let contents = try await client.getContents(owner: owner, repo: repo.name, path: currentPath)
            await MainActor.run {
                self.fileTree = contents.sorted { $0.type == "dir" && $1.type != "dir" }
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to load files: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }
    
    func navigateTo(path: String) {
        self.currentPath = path
        Task { await refreshFileTree() }
    }
    
    func navigateUp() {
        guard !currentPath.isEmpty else { return }
        let components = currentPath.split(separator: "/")
        if components.count > 1 {
            self.currentPath = components.dropLast().joined(separator: "/")
        } else {
            self.currentPath = ""
        }
        Task { await refreshFileTree() }
    }
    
    // MARK: - File Operations
    
    func getFileContent(path: String) async throws -> GitHubContent {
        guard let client = apiClient, let repo = selectedRepo, let owner = repo.owner?.login else {
            throw GitError.notConfigured
        }
        return try await client.getFileContent(owner: owner, repo: repo.name, path: path)
    }
    
    func updateFileOnGitHub(path: String, content: String, sha: String, message: String) async {
        guard let client = apiClient, let repo = selectedRepo, let owner = repo.owner?.login else { return }
        await MainActor.run { isLoading = true }
        
        do {
            let contentBase64 = Data(content.utf8).base64EncodedString()
            _ = try await client.updateFile(owner: owner, repo: repo.name, path: path, message: message, contentBase64: contentBase64, sha: sha)
            await MainActor.run {
                self.successMessage = "File updated successfully"
                self.isLoading = false
            }
            await refreshFileTree()
        } catch {
            await MainActor.run {
                self.errorMessage = "Failed to update file: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }
    
    // Sync Logic
    
    func syncGitHubToLocal(content: GitHubContent) async {
        guard let client = apiClient, let repo = selectedRepo, let owner = repo.owner?.login else { return }
        await MainActor.run { isLoading = true }
        
        do {
            // Get full content
            let fileData = try await client.getFileContent(owner: owner, repo: repo.name, path: content.path)
            
            // Decode content
            if let encoded = fileData.content, let data = Data(base64Encoded: encoded.replacingOccurrences(of: "\n", with: "")) {
                if let textContent = String(data: data, encoding: .utf8) {
                    _ = try await fileService.createTextFile(name: content.name, content: textContent, accessToken: "")
                } else {
                    _ = try await fileService.createBinaryFile(name: content.name, data: data, accessToken: "")
                }
            }
            
            await MainActor.run {
                self.successMessage = "Synced \(content.name) to local"
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.errorMessage = "Sync failed: \(error.localizedDescription)"
                self.isLoading = false
            }
        }
    }
    
    func commitAllLocalFiles() async {
        // Implement bulk commit logic similar to Android
        // 1. List local files
        // 2. Loop and upload
        do {
            let files = try await fileService.listFiles(withExtension: nil, includeContent: true, accessToken: "")
            guard let client = apiClient, let repo = selectedRepo, let owner = repo.owner?.login else { return }
            
            for file in files {
                let encoded: String
                if let text = file.textContent {
                    encoded = Data(text.utf8).base64EncodedString()
                } else if let data = file.binaryContent {
                    encoded = data.base64EncodedString()
                } else {
                    continue
                }
                
                // Need to check if file exists to get SHA if updating, or just create if new.
                // For simplicity in "Create Repo" flow, we assume new.
                // But for robust sync, we should check.
                // Here we just try create (will fail if exists)
                try? await client.createFile(owner: owner, repo: repo.name, path: file.metadata.name, message: "Add \(file.metadata.name)", contentBase64: encoded)
            }
        } catch {
            print("Commit all error: \(error)")
        }
    }
    
    // Helper to get local content for diff
    func getLocalFileContent(name: String) async -> String? {
        do {
            let file = try await fileService.getFile(id: name, accessToken: "")
            return file.textContent
        } catch {
            return nil
        }
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
