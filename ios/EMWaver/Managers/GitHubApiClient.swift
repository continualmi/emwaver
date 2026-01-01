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

class GitHubApiClient {
    private let baseUrl = "https://api.github.com"
    private var token: String
    
    init(token: String) {
        self.token = token
    }
    
    func updateToken(_ token: String) {
        self.token = token
    }
    
    // MARK: - User
    
    func getUser() async throws -> GitHubUser {
        let url = URL(string: "\(baseUrl)/user")!
        return try await performRequest(url: url)
    }
    
    // MARK: - Repositories
    
    func listRepositories() async throws -> [GitHubRepository] {
        let url = URL(string: "\(baseUrl)/user/repos?sort=updated&per_page=100")!
        return try await performRequest(url: url)
    }
    
    func createRepository(name: String, description: String, isPrivate: Bool) async throws -> GitHubRepository {
        let url = URL(string: "\(baseUrl)/user/repos")!
        let body: [String: Any] = [
            "name": name,
            "description": description,
            "private": isPrivate,
            "auto_init": true
        ]
        return try await performRequest(url: url, method: "POST", body: body)
    }
    
    // MARK: - Contents
    
    func getContents(owner: String, repo: String, path: String) async throws -> [GitHubContent] {
        // Handle root path empty string
        let pathComponent = path.isEmpty ? "" : "/\(path)"
        // Encode path to handle spaces etc
        guard let encodedPath = pathComponent.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw GitError.apiError("Invalid path")
        }
        
        let urlString = "\(baseUrl)/repos/\(owner)/\(repo)/contents\(encodedPath)"
        guard let url = URL(string: urlString) else {
            throw GitError.apiError("Invalid URL")
        }
        
        return try await performRequest(url: url)
    }
    
    func getFileContent(owner: String, repo: String, path: String) async throws -> GitHubContent {
         guard let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw GitError.apiError("Invalid path")
        }
        let url = URL(string: "\(baseUrl)/repos/\(owner)/\(repo)/contents/\(encodedPath)")!
        return try await performRequest(url: url)
    }
    
    func createFile(owner: String, repo: String, path: String, message: String, contentBase64: String) async throws -> GitHubCommit {
        guard let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw GitError.apiError("Invalid path")
        }
        let url = URL(string: "\(baseUrl)/repos/\(owner)/\(repo)/contents/\(encodedPath)")!
        
        let body: [String: Any] = [
            "message": message,
            "content": contentBase64
        ]
        
        return try await performRequest(url: url, method: "PUT", body: body)
    }
    
    func updateFile(owner: String, repo: String, path: String, message: String, contentBase64: String, sha: String) async throws -> GitHubCommit {
        guard let encodedPath = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            throw GitError.apiError("Invalid path")
        }
        let url = URL(string: "\(baseUrl)/repos/\(owner)/\(repo)/contents/\(encodedPath)")!
        
        let body: [String: Any] = [
            "message": message,
            "content": contentBase64,
            "sha": sha
        ]
        
        return try await performRequest(url: url, method: "PUT", body: body)
    }
    
    // MARK: - Private Helpers
    
    private func performRequest<T: Decodable>(url: URL, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("token \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        
        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw GitError.invalidResponse
        }
        
        if httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 {
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                print("Decoding error: \(error)")
                if let str = String(data: data, encoding: .utf8) {
                    print("Response body: \(str)")
                }
                throw error
            }
        } else {
            if let errorResponse = try? JSONDecoder().decode(GitHubError.self, from: data) {
                throw GitError.apiError(errorResponse.message)
            } else {
                throw GitError.apiError("HTTP \(httpResponse.statusCode)")
            }
        }
    }
}
