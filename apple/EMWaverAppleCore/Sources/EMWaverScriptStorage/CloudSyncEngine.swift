/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

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
    private static func debugEnabled() -> Bool {
        (ProcessInfo.processInfo.environment["EMWAVER_SYNC_DEBUG"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) == "1"
    }

    private static func debug(_ msg: String) {
        guard debugEnabled() else { return }
        print("[CloudSync] \(msg)")
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
        guard !accessToken.isEmpty else {
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

            let names = Set(cloudByName.keys).union(localByName.keys)

            for name in names.sorted() {
                let localURL = localByName[name]
                let cloudMeta = cloudByName[name]

                // Ensure we have an index entry if we have cloud meta.
                if let cloudMeta {
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: cloudMeta.metadata.id, cloudEtag: cloudMeta.metadata.etag)
                }

                let entry = index.entries.first(where: { $0.kind == spec.kind && $0.name == name })

                let localEtag = localURL.flatMap { try? computeLocalEtag(url: $0) }
                let cloudEtag = cloudMeta?.metadata.etag

                switch (localURL, cloudMeta) {
                case (nil, let cloud?):
                    // Cloud-only -> download.
                    Self.debug("download \(spec.kind) \(name) (cloudId=\(cloud.metadata.id))")
                    do {
                        try await download(cloud: cloud, to: storageDir.appendingPathComponent(name), baseURL: baseURL, accessToken: accessToken)
                        summary.downloaded += 1
                        updateIndexAfterSync(&index, kind: spec.kind, name: name, localEtag: try? computeLocalEtag(url: storageDir.appendingPathComponent(name)), cloudEtag: cloud.metadata.etag)
                    } catch {
                        // If Azure blob is missing (common during early dev when init-upload happened but PUT/commit failed),
                        // leave the local file absent and surface the error to the caller.
                        Self.debug("download failed \(spec.kind) \(name): \(error)")
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
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: f.metadata.id, cloudEtag: f.metadata.etag)
                    updateIndexAfterSync(&index, kind: spec.kind, name: name, localEtag: localEtag, cloudEtag: f.metadata.etag)

                case (let local?, let cloud?):
                    // Both exist.
                    let last = index.entries.first(where: { $0.kind == spec.kind && $0.name == name })
                    let lastLocal = last?.lastSyncedLocalEtag
                    let lastCloud = last?.lastSyncedCloudEtag

                    let localChanged = (lastLocal != nil && localEtag != lastLocal) || (lastLocal == nil && localEtag != nil)
                    let cloudChanged = (lastCloud != nil && cloud.metadata.etag != lastCloud) || (lastCloud == nil && cloud.metadata.etag != nil)

                    if localChanged {
                        // Overwrite-by-name flow: just upload the local bytes again.
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
                    } else if cloudChanged {
                        // Download cloud.
                        try await download(cloud: cloud, to: local, baseURL: baseURL, accessToken: accessToken)
                        summary.downloaded += 1
                        updateIndexAfterSync(&index, kind: spec.kind, name: name, localEtag: try? computeLocalEtag(url: local), cloudEtag: cloud.metadata.etag)
                    } else if localChanged && cloudChanged {
                        // Conflict.
                        switch policy {
                        case .preferLocal:
                            // Keep local, download cloud as a conflict copy.
                            let conflictURL = storageDir.appendingPathComponent(makeConflictName(original: name, suffix: "cloud"))
                            try await download(cloud: cloud, to: conflictURL, baseURL: baseURL, accessToken: accessToken)
                            summary.conflicts += 1
                            summary.downloaded += 1
                        }
                    } else {
                        // No-op.
                    }

                    // Refresh stored mapping.
                    upsertIndex(&index, kind: spec.kind, name: name, cloudId: cloud.metadata.id, cloudEtag: cloud.metadata.etag)
                    updateIndexAfterSync(&index, kind: spec.kind, name: name, localEtag: localEtag, cloudEtag: cloud.metadata.etag)

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
            return IndexFile(version: 1, entries: [])
        }
        let data = try Data(contentsOf: url)
        if let decoded = try? JSONDecoder().decode(IndexFile.self, from: data) {
            return decoded
        }
        return IndexFile(version: 1, entries: [])
    }

    private func saveIndex(_ index: IndexFile, storageDir: URL) throws {
        let url = indexURL(storageDir: storageDir)
        let data = try JSONEncoder().encode(index)
        try data.write(to: url, options: [.atomic])
    }

    private func upsertIndex(_ index: inout IndexFile, kind: String, name: String, cloudId: String, cloudEtag: String?) {
        if let i = index.entries.firstIndex(where: { $0.kind == kind && $0.name == name }) {
            index.entries[i].cloudId = cloudId
            if index.entries[i].lastSyncedCloudEtag == nil {
                index.entries[i].lastSyncedCloudEtag = cloudEtag
            }
        } else {
            index.entries.append(IndexEntry(kind: kind, name: name, cloudId: cloudId, lastSyncedLocalEtag: nil, lastSyncedCloudEtag: cloudEtag))
        }
    }

    private func updateIndexAfterSync(_ index: inout IndexFile, kind: String, name: String, localEtag: String?, cloudEtag: String?) {
        guard let i = index.entries.firstIndex(where: { $0.kind == kind && $0.name == name }) else { return }
        index.entries[i].lastSyncedLocalEtag = localEtag
        index.entries[i].lastSyncedCloudEtag = cloudEtag
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
