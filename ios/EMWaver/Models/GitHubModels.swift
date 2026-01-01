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

struct GitHubRepository: Codable, Identifiable {
    var id: Int?
    var name: String
    var fullName: String
    var owner: GitHubUser?
    var isPrivate: Bool
    var description: String?
    var htmlUrl: String?
    var defaultBranch: String?
    
    enum CodingKeys: String, CodingKey {
        case id, name
        case fullName = "full_name"
        case owner
        case isPrivate = "private"
        case description
        case htmlUrl = "html_url"
        case defaultBranch = "default_branch"
    }
}

struct GitHubUser: Codable {
    var login: String
    var id: Int?
    var avatarUrl: String?
    
    enum CodingKeys: String, CodingKey {
        case login, id
        case avatarUrl = "avatar_url"
    }
}

struct GitHubContent: Codable, Identifiable {
    var name: String
    var path: String
    var sha: String
    var size: Int?
    var url: String?
    var htmlUrl: String?
    var gitUrl: String?
    var downloadUrl: String?
    var type: String
    var content: String?
    var encoding: String?
    
    var id: String { sha } // Use SHA as ID for Identifiable
    
    enum CodingKeys: String, CodingKey {
        case name, path, sha, size, url
        case htmlUrl = "html_url"
        case gitUrl = "git_url"
        case downloadUrl = "download_url"
        case type, content, encoding
    }
}

struct GitHubCommit: Codable {
    var sha: String
    var commit: CommitInfo
    
    struct CommitInfo: Codable {
        var message: String
        var author: CommitAuthor
        var committer: CommitAuthor
    }
    
    struct CommitAuthor: Codable {
        var name: String
        var email: String
        var date: String
    }
}

struct GitHubError: Codable {
    var message: String
    var documentationUrl: String?
    
    enum CodingKeys: String, CodingKey {
        case message
        case documentationUrl = "documentation_url"
    }
}
