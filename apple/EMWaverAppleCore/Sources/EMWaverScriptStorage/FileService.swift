/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import os

public enum FileServiceError: LocalizedError {
    case fileNotFound
    case invalidResponse
    case fileSystem(Error)

    public var errorDescription: String? {
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

public final class FileService {
    public static let shared = FileService()

    private static let internalBootstrapName = "script_bootstrap.emw"

    private static func isReservedInternalName(_ name: String) -> Bool {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == internalBootstrapName
    }

    private static let log = OSLog(subsystem: "com.emwaver", category: "FileService")

    private static func debugEnabled() -> Bool {
        true
    }

    private static func debug(_ msg: String) {
        guard debugEnabled() else { return }
        os_log("%{public}@", log: log, type: .fault, "[FileService] \(msg)")
    }

    private let storageDir: URL
    private let signalsDir: URL
    private let fileManager = FileManager.default

    /// Exposes the local scripts storage directory so higher-level services (like cloud sync)
    /// can work without duplicating path logic.
    public func storageDirectoryURL() -> URL { storageDir }

    /// Signals are stored under Application Support/signals (matches sampler.emw usage).
    public func signalsDirectoryURL() -> URL { signalsDir }

    public init() {
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        storageDir = documentsPath.appendingPathComponent("scripts", isDirectory: true)

        // Keep signals alongside scripts to simplify user-visible storage + sync.
        // (Signals are still conceptually separate, but live in the same directory.)
        signalsDir = storageDir

        try? fileManager.createDirectory(at: storageDir, withIntermediateDirectories: true)
        // signalsDir == storageDir

        Self.debug("scriptsDir=\(storageDir.path)")
        Self.debug("signalsDir=\(signalsDir.path)")
    }

    public func listFiles(
        withExtension fileExtension: String?,
        includeContent: Bool,
        accessToken: String
    ) async throws -> [UserFileData] {
        try await listFiles(in: storageDir, withExtension: fileExtension, includeContent: includeContent)
    }

    public func listSignalFiles(
        withExtension fileExtension: String?,
        includeContent: Bool,
        accessToken: String
    ) async throws -> [UserFileData] {
        try await listFiles(in: signalsDir, withExtension: fileExtension, includeContent: includeContent)
    }

    private func listFiles(
        in dir: URL,
        withExtension fileExtension: String?,
        includeContent: Bool
    ) async throws -> [UserFileData] {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let files = try self.fileManager.contentsOfDirectory(
                        at: dir,
                        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]
                    )
                    Self.debug("list dir=\(dir.lastPathComponent) path=\(dir.path) filter=\(fileExtension ?? "<any>") total=\(files.count)")

                    var result: [UserFileData] = []
                    for fileURL in files {
                        guard fileURL.isFileURL else { continue }
                        let fileName = fileURL.lastPathComponent
                        if Self.isReservedInternalName(fileName) {
                            continue
                        }
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

    public func getFile(id: String, accessToken: String) async throws -> UserFileData {
        try await withCheckedThrowingContinuation { continuation in
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
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }

    public func createTextFile(name: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        if Self.isReservedInternalName(name) {
            throw FileServiceError.invalidResponse
        }
        return try await createFile(name: name, data: content.data(using: .utf8) ?? Data(), contentType: "text/plain")
    }

    public func renameFile(id: String, name: String, accessToken: String) async throws -> UserFileMetadata {
        if Self.isReservedInternalName(name) {
            throw FileServiceError.invalidResponse
        }
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

    public func updateTextFile(id: String, etag: String, content: String, accessToken: String) async throws -> UserFileMetadata {
        if Self.isReservedInternalName(id) {
            throw FileServiceError.invalidResponse
        }
        return try await createFile(name: id, data: content.data(using: .utf8) ?? Data(), contentType: "text/plain", overwrite: true)
    }

    public func deleteFile(id: String, etag: String?, accessToken: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
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

    private func createFile(name: String, data: Data, contentType: String, overwrite: Bool = false) async throws -> UserFileMetadata {
        try await withCheckedThrowingContinuation { continuation in
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
                    let computedEtag = String(Int(lastModified.timeIntervalSince1970))

                    let ext = (name as NSString).pathExtension
                    let metadata = UserFileMetadata(
                        id: name,
                        name: name,
                        fileExtension: ext.isEmpty ? "" : ".\(ext)",
                        kind: "file",
                        etag: computedEtag,
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
