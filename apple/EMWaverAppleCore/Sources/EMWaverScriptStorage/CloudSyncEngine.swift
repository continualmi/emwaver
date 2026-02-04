/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import CryptoKit
import os

public enum CloudSyncPolicy {
    /// If both changed, keep local as canonical and download the cloud version as a conflict copy.
    case preferLocal
}

public struct CloudSyncSummary: Equatable {
    public var uploaded: Int = 0
    public var downloaded: Int = 0
    public var conflicts: Int = 0
}

public final class CloudSyncEngine {
    private static let log = OSLog(subsystem: "com.emwaver", category: "CloudSync")
    private static func debugEnabled() -> Bool {
        true
    }

    private static func debug(_ msg: String) {
        guard debugEnabled() else { return }
        os_log("%{public}@", log: log, type: .fault, "[CloudSync] \(msg)")
    }

    private static let uploadSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 20
        cfg.timeoutIntervalForResource = 60
        return URLSession(configuration: cfg)
    }()

    public struct FileKindSpec: Equatable {
        public let kind: String
        public let ext: String
        public let contentType: String

        public init(kind: String, ext: String, contentType: String) {
            self.kind = kind
            self.ext = ext
            self.contentType = contentType
        }
    }

    private struct IndexEntry: Codable, Equatable {
        let kind: String
        let name: String
        var cloudId: String
        var lastSyncedLocalEtag: String?
        var lastSyncedCloudEtag: String?
        var lastSyncedLocalSha256: String?
        var lastSyncedCloudSha256: String?
    }

    private struct IndexFile: Codable, Equatable {
        var version: Int
        var entries: [IndexEntry]
    }

    private let api: CloudFilesAPI
    private let fileManager = FileManager.default

    public init(api: CloudFilesAPI = CloudFilesAPI()) {
        self.api = api
    }

    public func sync(
        baseURL: URL,
        accessToken: String,
        storageDir: URL,
        kinds: [FileKindSpec],
        policy: CloudSyncPolicy = .preferLocal
    ) async throws -> CloudSyncSummary {
        Self.debug("sync begin dir=\(storageDir.path) tokenLen=\(accessToken.count)")
        guard !accessToken.isEmpty else {
            Self.debug("sync aborted: empty access token")
            // Signed-out: no-op.
            return CloudSyncSummary()
        }

        // Single supported flow: backend-mediated upload/download.
        let useBackendFlow = true

        var summary = CloudSyncSummary()
        var index = try loadIndex(storageDir: storageDir)

        for spec in kinds {
            let cloud = try await api.listFiles(baseURL: baseURL, accessToken: accessToken, kind: spec.kind, ext: spec.ext)
            let cloudByName: [String: CloudFileMetadata] = Dictionary(uniqueKeysWithValues: cloud.map { ($0.metadata.name, $0) })

            let localURLs = try localFiles(in: storageDir, withSuffix: spec.ext)
            let localByName: [String: URL] = Dictionary(uniqueKeysWithValues: localURLs.map { ($0.lastPathComponent, $0) })

            Self.debug("Kind=\(spec.kind) ext=\(spec.ext) local=\(localByName.count) cloud=\(cloudByName.count) dir=\(storageDir.path)")
            if Self.debugEnabled() {
                let localNames = localByName.keys.sorted().joined(separator: ", ")
                let cloudNames = cloudByName.keys.sorted().joined(separator: ", ")
                Self.debug("localNames=[\(localNames)]")
                Self.debug("cloudNames=[\(cloudNames)]")
            }

            let names = Set(cloudByName.keys).union(localByName.keys)

            for name in names.sorted() {
                let localURL = localByName[name]
                let cloudMeta = cloudByName[name]

                // Ensure we have an index entry if we have cloud meta.
                if let cloudMeta {
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: cloudMeta.metadata.id, cloudEtag: cloudMeta.metadata.etag, cloudSha256: cloudMeta.metadata.sha256)
                }

                let entry = index.entries.first(where: { $0.kind == spec.kind && $0.name == name })

                let localEtag = localURL.flatMap { try? computeLocalEtag(url: $0) }
                let cloudEtag = cloudMeta?.metadata.etag

                let localSha = localURL.flatMap { try? computeLocalSha256(url: $0) }
                let cloudSha = cloudMeta?.metadata.sha256

                if Self.debugEnabled() {
                    Self.debug("name=\(name) local=\(localURL != nil) cloud=\(cloudMeta != nil) localEtag=\(localEtag ?? "-") cloudEtag=\(cloudEtag ?? "-")")
                    Self.debug("  localSha=\(localSha ?? "-")")
                    Self.debug("  cloudSha=\(cloudSha ?? "-")")
                }

                switch (localURL, cloudMeta) {
                case (nil, let cloud?):
                    // Cloud-only -> download.
                    Self.debug("download \(spec.kind) \(name) (cloudId=\(cloud.metadata.id))")
                    do {
                        try await download(cloud: cloud, to: storageDir.appendingPathComponent(name), baseURL: baseURL, accessToken: accessToken)
                        summary.downloaded += 1
                        let dest = storageDir.appendingPathComponent(name)
                        updateIndexAfterSync(
                            &index,
                            kind: spec.kind,
                            name: name,
                            localEtag: try? computeLocalEtag(url: dest),
                            cloudEtag: cloud.metadata.etag,
                            localSha256: try? computeLocalSha256(url: dest),
                            cloudSha256: cloud.metadata.sha256
                        )
                    } catch {
                        // If cloud metadata exists but blob is missing/corrupt, do not abort sync.
                        // This situation can happen due to earlier flows; best effort: delete the broken cloud entry.
                        Self.debug("download failed \(spec.kind) \(name): \(error)")
                        if case CloudFilesAPIError.serverError(let code, _) = error, (code == 404 || code == 502) {
                            if let etag = cloud.metadata.etag {
                                Self.debug("deleting broken cloud entry \(cloud.metadata.id) etag=\(etag)")
                                try? await api.deleteFile(baseURL: baseURL, accessToken: accessToken, fileId: cloud.metadata.id, etag: etag)
                            }
                            // Skip this file and continue with the rest.
                            break
                        }
                        throw error
                    }

                case (let local?, nil):
                    // Local-only -> upload.
                    Self.debug("upload \(spec.kind) \(name) (local-only)")
                    let data = try Data(contentsOf: local)
                    let f = try await api.uploadViaBackend(
                        baseURL: baseURL,
                        accessToken: accessToken,
                        kind: spec.kind,
                        name: name,
                        contentType: spec.contentType,
                        bytes: data
                    )
                    summary.uploaded += 1
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: f.metadata.id, cloudEtag: f.metadata.etag, cloudSha256: f.metadata.sha256)
                    updateIndexAfterSync(
                        &index,
                        kind: spec.kind,
                        name: name,
                        localEtag: localEtag,
                        cloudEtag: f.metadata.etag,
                        localSha256: localSha,
                        cloudSha256: f.metadata.sha256
                    )

                case (let local?, let cloud?):
                    // Both exist.
                    let last = index.entries.first(where: { $0.kind == spec.kind && $0.name == name })
                    let lastLocalEtag = last?.lastSyncedLocalEtag
                    let lastCloudEtag = last?.lastSyncedCloudEtag
                    let lastLocalSha = last?.lastSyncedLocalSha256
                    let lastCloudSha = last?.lastSyncedCloudSha256

                    // Prefer sha256 when available; fall back to etag/mtime.
                    let localChanged: Bool = {
                        if let localSha, let lastLocalSha { return localSha != lastLocalSha }
                        return (lastLocalEtag != nil && localEtag != lastLocalEtag) || (lastLocalEtag == nil && localEtag != nil)
                    }()

                    let cloudChanged: Bool = {
                        if let cloudSha, let lastCloudSha { return cloudSha != lastCloudSha }
                        return (lastCloudEtag != nil && cloud.metadata.etag != lastCloudEtag) || (lastCloudEtag == nil && cloud.metadata.etag != nil)
                    }()

                    if Self.debugEnabled() {
                        Self.debug("  lastLocalEtag=\(lastLocalEtag ?? "-") lastCloudEtag=\(lastCloudEtag ?? "-")")
                        Self.debug("  lastLocalSha=\(lastLocalSha ?? "-") lastCloudSha=\(lastCloudSha ?? "-")")
                        Self.debug("  decisionFlags localChanged=\(localChanged) cloudChanged=\(cloudChanged)")
                    }

                    // If we have both hashes and they match, nothing to do.
                    if let localSha, let cloudSha, localSha == cloudSha {
                        upsertIndex(&index, kind: spec.kind, name: name, cloudId: cloud.metadata.id, cloudEtag: cloud.metadata.etag, cloudSha256: cloudSha)
                        updateIndexAfterSync(&index, kind: spec.kind, name: name, localEtag: localEtag, cloudEtag: cloud.metadata.etag, localSha256: localSha, cloudSha256: cloudSha)
                        break
                    }

                    // If we have no prior sync state but hashes differ, treat as conflict.
                    let hasHistory = (lastLocalSha != nil || lastCloudSha != nil || lastLocalEtag != nil || lastCloudEtag != nil)
                    let treatAsConflict = (!hasHistory && localSha != nil && cloudSha != nil && localSha != cloudSha)

                    if treatAsConflict || (localChanged && cloudChanged) {
                        // Conflict.
                        switch policy {
                        case .preferLocal:
                            // Keep local, download cloud as a conflict copy.
                            let conflictURL = storageDir.appendingPathComponent(makeConflictName(original: name, suffix: "cloud"))
                            try await download(cloud: cloud, to: conflictURL, baseURL: baseURL, accessToken: accessToken)
                            summary.conflicts += 1
                            summary.downloaded += 1
                        }
                    } else if localChanged && !cloudChanged {
                        // Upload local (overwrite-by-name).
                        let data = try Data(contentsOf: local)
                        _ = try await api.uploadViaBackend(
                            baseURL: baseURL,
                            accessToken: accessToken,
                            kind: spec.kind,
                            name: name,
                            contentType: spec.contentType,
                            bytes: data
                        )
                        summary.uploaded += 1
                    } else if !localChanged && cloudChanged {
                        // Download cloud.
                        do {
                            try await download(cloud: cloud, to: local, baseURL: baseURL, accessToken: accessToken)
                            summary.downloaded += 1
                            updateIndexAfterSync(
                                &index,
                                kind: spec.kind,
                                name: name,
                                localEtag: try? computeLocalEtag(url: local),
                                cloudEtag: cloud.metadata.etag,
                                localSha256: try? computeLocalSha256(url: local),
                                cloudSha256: cloud.metadata.sha256
                            )
                        } catch {
                            // If the cloud metadata exists but the blob is missing/corrupt,
                            // prefer local and overwrite cloud by name.
                            if case CloudFilesAPIError.serverError(let code, _) = error, (code == 404 || code == 502) {
                                Self.debug("cloud download failed for \(name) (\(code)); overwriting from local")
                                let data = try Data(contentsOf: local)
                                _ = try await api.uploadViaBackend(
                                    baseURL: baseURL,
                                    accessToken: accessToken,
                                    kind: spec.kind,
                                    name: name,
                                    contentType: spec.contentType,
                                    bytes: data
                                )
                                summary.uploaded += 1
                            } else {
                                throw error
                            }
                        }
                    } else {
                        // No-op.
                    }

                    // Refresh stored mapping.
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: cloud.metadata.id, cloudEtag: cloud.metadata.etag, cloudSha256: cloud.metadata.sha256)
                    updateIndexAfterSync(
                        &index,
                        kind: spec.kind,
                        name: name,
                        localEtag: localEtag,
                        cloudEtag: cloud.metadata.etag,
                        localSha256: localSha,
                        cloudSha256: cloud.metadata.sha256
                    )

                case (nil, nil):
                    break
                }
            }
        }

        try saveIndex(index, storageDir: storageDir)
        return summary
    }

    // MARK: - Local

    private func localFiles(in dir: URL, withSuffix suffix: String) throws -> [URL] {
        let files = try fileManager.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles])
        return files.filter { $0.pathExtension.isEmpty == false && $0.lastPathComponent.hasSuffix(suffix) }
    }

    private func computeLocalEtag(url: URL) throws -> String {
        let attrs = try url.resourceValues(forKeys: [.contentModificationDateKey])
        let date = attrs.contentModificationDate ?? Date()
        return String(Int(date.timeIntervalSince1970))
    }

    private func computeLocalSha256(url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 1024 * 1024) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Transfer

    private func download(cloud: CloudFileMetadata, to localURL: URL, baseURL: URL, accessToken: String) async throws {
        let (data, _) = try await api.downloadContentViaBackend(baseURL: baseURL, accessToken: accessToken, fileId: cloud.metadata.id)
        try data.write(to: localURL, options: [.atomic])
    }


    // MARK: - Index

    private func indexURL(storageDir: URL) -> URL {
        storageDir.appendingPathComponent(".cloud_sync_index.json")
    }

    private func loadIndex(storageDir: URL) throws -> IndexFile {
        let url = indexURL(storageDir: storageDir)
        guard fileManager.fileExists(atPath: url.path) else {
            return IndexFile(version: 2, entries: [])
        }
        let data = try Data(contentsOf: url)
        if let decoded = try? JSONDecoder().decode(IndexFile.self, from: data) {
            return decoded
        }
        return IndexFile(version: 2, entries: [])
    }

    private func saveIndex(_ index: IndexFile, storageDir: URL) throws {
        let url = indexURL(storageDir: storageDir)
        let data = try JSONEncoder().encode(index)
        try data.write(to: url, options: [.atomic])
    }

    private func upsertIndex(
        _ index: inout IndexFile,
        kind: String,
        name: String,
        cloudId: String,
        cloudEtag: String?,
        cloudSha256: String? = nil
    ) {
        if let i = index.entries.firstIndex(where: { $0.kind == kind && $0.name == name }) {
            index.entries[i].cloudId = cloudId
            if index.entries[i].lastSyncedCloudEtag == nil {
                index.entries[i].lastSyncedCloudEtag = cloudEtag
            }
            if index.entries[i].lastSyncedCloudSha256 == nil {
                index.entries[i].lastSyncedCloudSha256 = cloudSha256
            }
        } else {
            index.entries.append(
                IndexEntry(
                    kind: kind,
                    name: name,
                    cloudId: cloudId,
                    lastSyncedLocalEtag: nil,
                    lastSyncedCloudEtag: cloudEtag,
                    lastSyncedLocalSha256: nil,
                    lastSyncedCloudSha256: cloudSha256
                )
            )
        }
    }

    private func updateIndexAfterSync(
        _ index: inout IndexFile,
        kind: String,
        name: String,
        localEtag: String?,
        cloudEtag: String?,
        localSha256: String?,
        cloudSha256: String?
    ) {
        guard let i = index.entries.firstIndex(where: { $0.kind == kind && $0.name == name }) else { return }
        index.entries[i].lastSyncedLocalEtag = localEtag
        index.entries[i].lastSyncedCloudEtag = cloudEtag
        index.entries[i].lastSyncedLocalSha256 = localSha256
        index.entries[i].lastSyncedCloudSha256 = cloudSha256
    }

    private func makeConflictName(original: String, suffix: String) -> String {
        let base = (original as NSString).deletingPathExtension
        let ext = (original as NSString).pathExtension
        let stamp = Int(Date().timeIntervalSince1970)
        if ext.isEmpty {
            return "\(base).conflict_\(suffix)_\(stamp)"
        }
        return "\(base).conflict_\(suffix)_\(stamp).\(ext)"
    }
}
