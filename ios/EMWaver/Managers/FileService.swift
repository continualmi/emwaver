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

enum FileServiceError: LocalizedError {
    case fileNotFound
    case invalidResponse
    case fileSystem(Error)

    var errorDescription: String? {
        switch self {
        case .fileNotFound:
            return "File not found"
        case .invalidResponse:
            return "Invalid file data"
        case .fileSystem(let error):
            return error.localizedDescription
        }
    }
}

final class FileService {
    static let shared = FileService()

    private let storageDir: URL
    private let fileManager = FileManager.default

    init() {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        storageDir = documentsPath.appendingPathComponent("wavelets", isDirectory: true)
        
        // Create directory if it doesn't exist
        try? fileManager.createDirectory(at: storageDir, withIntermediateDirectories: true)
    }

    // MARK: - Public API

    func listFiles(
        withExtension fileExtension: String?,
        includeContent: Bool,
        accessToken: String
    ) async throws -> [UserFileData] {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let files = try self.fileManager.contentsOfDirectory(at: self.storageDir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
                    
                    var result: [UserFileData] = []
                    for fileURL in files {
                        guard fileURL.isFileURL else { continue }
                        
                        let fileName = fileURL.lastPathComponent
                        if let ext = fileExtension, !fileName.hasSuffix(ext) {
                            continue
                        }
                        
                        let attributes = try fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                        let size = Int64(attributes.fileSize ?? 0)
                        let lastModified = attributes.contentModificationDate ?? Date()
                        let etag = String(Int(lastModified.timeIntervalSince1970))
                        
                        let ext = (fileName as NSString).pathExtension
                        let kind = "file"
                        let contentType = ext == "js" ? "text/javascript" : "text/plain"
                        
                        let metadata = UserFileMetadata(
                            id: fileName,
                            name: fileName,
                            fileExtension: ext.isEmpty ? "" : ".\(ext)",
                            kind: kind,
                            etag: etag,
                            sizeBytes: size,
                            contentType: contentType
                        )
                        
                        if includeContent {
                            let data = try Data(contentsOf: fileURL)
                            let textContent = String(data: data, encoding: .utf8)
                            result.append(UserFileData(metadata: metadata, textContent: textContent, binaryContent: data))
                        } else {
                            result.append(UserFileData(metadata: metadata, textContent: nil, binaryContent: nil))
                        }
                    }
                    
                    continuation.resume(returning: result)
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }

    func getFile(id: String, accessToken: String) async throws -> UserFileData {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let fileURL = self.storageDir.appendingPathComponent(id)
                    guard self.fileManager.fileExists(atPath: fileURL.path) else {
                        continuation.resume(throwing: FileServiceError.fileNotFound)
                        return
                    }
                    
                    let attributes = try fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                    let size = Int64(attributes.fileSize ?? 0)
                    let lastModified = attributes.contentModificationDate ?? Date()
                    let etag = String(Int(lastModified.timeIntervalSince1970))
                    
                    let fileName = fileURL.lastPathComponent
                    let ext = (fileName as NSString).pathExtension
                    let kind = "file"
                    let contentType = ext == "js" ? "text/javascript" : "text/plain"
                    
                    let metadata = UserFileMetadata(
                        id: id,
                        name: fileName,
                        fileExtension: ext.isEmpty ? "" : ".\(ext)",
                        kind: kind,
                        etag: etag,
                        sizeBytes: size,
                        contentType: contentType
                    )
                    
                    let data = try Data(contentsOf: fileURL)
                    let textContent = String(data: data, encoding: .utf8)
                    let fileData = UserFileData(metadata: metadata, textContent: textContent, binaryContent: data)
                    
                    continuation.resume(returning: fileData)
                } catch {
                    if let fileError = error as? FileServiceError {
                        continuation.resume(throwing: fileError)
                    } else {
                        continuation.resume(throwing: FileServiceError.fileSystem(error))
                    }
                }
            }
        }
    }

    func createTextFile(name: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        return try await createFile(name: name, data: content.data(using: .utf8) ?? Data(), contentType: "text/plain")
    }

    func createBinaryFile(name: String, data: Data, accessToken: String) async throws -> UserFileMetadata {
        return try await createFile(name: name, data: data, contentType: "application/octet-stream")
    }

    func copyFile(sourceId: String, name: String, accessToken: String) async throws -> UserFileMetadata {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let sourceURL = self.storageDir.appendingPathComponent(sourceId)
                    let destURL = self.storageDir.appendingPathComponent(name)
                    
                    guard self.fileManager.fileExists(atPath: sourceURL.path) else {
                        continuation.resume(throwing: FileServiceError.fileNotFound)
                        return
                    }
                    
                    try self.fileManager.copyItem(at: sourceURL, to: destURL)
                    
                    let attributes = try destURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                    let size = Int64(attributes.fileSize ?? 0)
                    let lastModified = attributes.contentModificationDate ?? Date()
                    let etag = String(Int(lastModified.timeIntervalSince1970))
                    
                    let ext = (name as NSString).pathExtension
                    let contentType = ext == "js" ? "text/javascript" : "text/plain"
                    
                    let metadata = UserFileMetadata(
                        id: name,
                        name: name,
                        fileExtension: ext.isEmpty ? "" : ".\(ext)",
                        kind: "file",
                        etag: etag,
                        sizeBytes: size,
                        contentType: contentType
                    )
                    
                    continuation.resume(returning: metadata)
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }

    func renameFile(id: String, name: String, accessToken: String) async throws -> UserFileMetadata {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let oldURL = self.storageDir.appendingPathComponent(id)
                    let newURL = self.storageDir.appendingPathComponent(name)
                    
                    guard self.fileManager.fileExists(atPath: oldURL.path) else {
                        continuation.resume(throwing: FileServiceError.fileNotFound)
                        return
                    }
                    
                    try self.fileManager.moveItem(at: oldURL, to: newURL)
                    
                    let attributes = try newURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                    let size = Int64(attributes.fileSize ?? 0)
                    let lastModified = attributes.contentModificationDate ?? Date()
                    let etag = String(Int(lastModified.timeIntervalSince1970))
                    
                    let ext = (name as NSString).pathExtension
                    let contentType = ext == "js" ? "text/javascript" : "text/plain"
                    
                    let metadata = UserFileMetadata(
                        id: name,
                        name: name,
                        fileExtension: ext.isEmpty ? "" : ".\(ext)",
                        kind: "file",
                        etag: etag,
                        sizeBytes: size,
                        contentType: contentType
                    )
                    
                    continuation.resume(returning: metadata)
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }

    func updateTextFile(id: String, etag: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        return try await createFile(name: id, data: content.data(using: .utf8) ?? Data(), contentType: "text/plain", overwrite: true)
    }

    func updateBinaryFile(id: String, etag: String, data: Data, accessToken: String) async throws -> UserFileMetadata {
        return try await createFile(name: id, data: data, contentType: "application/octet-stream", overwrite: true)
    }

    func deleteFile(id: String, etag: String?, accessToken: String) async throws {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let fileURL = self.storageDir.appendingPathComponent(id)
                    guard self.fileManager.fileExists(atPath: fileURL.path) else {
                        continuation.resume(throwing: FileServiceError.fileNotFound)
                        return
                    }
                    
                    try self.fileManager.removeItem(at: fileURL)
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }

    // MARK: - Private Helpers

    private func createFile(name: String, data: Data, contentType: String, overwrite: Bool = false) async throws -> UserFileMetadata {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let fileURL = self.storageDir.appendingPathComponent(name)
                    
                    if !overwrite && self.fileManager.fileExists(atPath: fileURL.path) {
                        continuation.resume(throwing: FileServiceError.fileSystem(NSError(domain: "FileService", code: 1, userInfo: [NSLocalizedDescriptionKey: "File already exists"])))
                        return
                    }
                    
                    try data.write(to: fileURL)
                    
                    let attributes = try fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                    let size = Int64(attributes.fileSize ?? 0)
                    let lastModified = attributes.contentModificationDate ?? Date()
                    let etag = String(Int(lastModified.timeIntervalSince1970))
                    
                    let ext = (name as NSString).pathExtension
                    let kind = "file"
                    
                    let metadata = UserFileMetadata(
                        id: name,
                        name: name,
                        fileExtension: ext.isEmpty ? "" : ".\(ext)",
                        kind: kind,
                        etag: etag,
                        sizeBytes: size,
                        contentType: contentType
                    )
                    
                    continuation.resume(returning: metadata)
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }
}
