/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import os

public struct CloudSyncSummary: Equatable {
    public var uploaded: Int = 0
    public var downloaded: Int = 0
    public var skipped: Int = 0
}

public final class CloudSyncEngine {
    private static let log = OSLog(subsystem: "com.emwaver", category: "CloudSync")

    private static func debug(_ msg: String) {
        os_log("%{public}@", log: log, type: .fault, "[CloudSync] \(msg)")
    }

    private let api: CloudFilesAPI
    private let fileManager = FileManager.default

    public init(api: CloudFilesAPI = CloudFilesAPI()) {
        self.api = api
    }

    public func sync(
        baseURL: URL,
        accessToken: String,
        storageDir: URL
    ) async throws -> CloudSyncSummary {
        Self.debug("sync begin dir=\(storageDir.path) tokenLen=\(accessToken.count)")
        guard !accessToken.isEmpty else {
            Self.debug("sync aborted: empty access token")
            return CloudSyncSummary()
        }

        let cloudFiles = try await api.listFiles(baseURL: baseURL, accessToken: accessToken)
        // Backend should de-dupe, but be defensive.
        let cloudByName: [String: CloudUserFile] = Dictionary(cloudFiles.map { ($0.name, $0) }, uniquingKeysWith: { a, b in
            // Prefer the one with mtime (if only one has it); otherwise keep the larger one.
            if a.mtimeMs == nil, b.mtimeMs != nil { return b }
            if a.mtimeMs != nil, b.mtimeMs == nil { return a }
            let asz = a.sizeBytes ?? 0
            let bsz = b.sizeBytes ?? 0
            return bsz >= asz ? b : a
        })

        let localURLs = try localFiles(in: storageDir)
        let localByName: [String: URL] = Dictionary(uniqueKeysWithValues: localURLs.map { ($0.lastPathComponent, $0) })

        Self.debug("local=\(localByName.count) cloud=\(cloudByName.count)")
        Self.debug("localNames=[\(localByName.keys.sorted().joined(separator: ", "))]")
        Self.debug("cloudNames=[\(cloudByName.keys.sorted().joined(separator: ", "))]")

        var summary = CloudSyncSummary()

        let names = Set(localByName.keys).union(cloudByName.keys)

        for name in names.sorted() {
            let localURL = localByName[name]
            let cloud = cloudByName[name]

            switch (localURL, cloud) {
            case (nil, nil):
                // Should be impossible because `name` comes from union(local, cloud), but keep switch exhaustive.
                summary.skipped += 1
                continue

            case (nil, let cloud?):
                // Cloud-only -> download
                Self.debug("download name=\(name) cloudEtag=\(cloud.etag ?? "-") mtime_ms=\(cloud.mtimeMs.map(String.init) ?? "-")")
                do {
                    let (data, _) = try await api.downloadContentViaBackend(baseURL: baseURL, accessToken: accessToken, blobKey: cloud.blobKey)
                    let dest = storageDir.appendingPathComponent(name)
                    try data.write(to: dest, options: .atomic)
                    if let mtime = cloud.mtimeMs {
                        try? setFileMtimeMs(url: dest, mtimeMs: mtime)
                    }
                    summary.downloaded += 1
                } catch {
                    Self.debug("download failed name=\(name): \(error)")
                    throw error
                }

            case (let local?, nil):
                // Local-only -> upload
                let data = try Data(contentsOf: local)
                let mtime = (try? fileMtimeMs(url: local)) ?? Int64(Date().timeIntervalSince1970 * 1000)
                let contentType = guessContentType(name: name)
                Self.debug("upload local-only name=\(name) bytes=\(data.count) mtime_ms=\(mtime)")
                _ = try await api.uploadViaBackend(
                    baseURL: baseURL,
                    accessToken: accessToken,
                    name: name,
                    contentType: contentType,
                    bytes: data,
                    mtimeMs: mtime
                )
                summary.uploaded += 1

            case (let local?, let cloud?):
                // Both exist -> choose by mtime
                let localMtime = (try? fileMtimeMs(url: local))
                let cloudMtime = cloud.mtimeMs

                Self.debug("both name=\(name) local_mtime=\(localMtime.map(String.init) ?? "-") cloud_mtime=\(cloudMtime.map(String.init) ?? "-")")

                // If either side lacks mtime, default to "newer local wins" to avoid destructive downloads.
                if let localMtime, let cloudMtime {
                    if localMtime == cloudMtime {
                        summary.skipped += 1
                        continue
                    } else if localMtime > cloudMtime {
                        let data = try Data(contentsOf: local)
                        let contentType = guessContentType(name: name)
                        Self.debug("upload newer-local name=\(name) bytes=\(data.count)")
                        _ = try await api.uploadViaBackend(
                            baseURL: baseURL,
                            accessToken: accessToken,
                            name: name,
                            contentType: contentType,
                            bytes: data,
                            mtimeMs: localMtime
                        )
                        summary.uploaded += 1
                        continue
                    } else {
                        Self.debug("download newer-cloud name=\(name)")
                        let (data, _) = try await api.downloadContentViaBackend(baseURL: baseURL, accessToken: accessToken, blobKey: cloud.blobKey)
                        try data.write(to: local, options: .atomic)
                        try? setFileMtimeMs(url: local, mtimeMs: cloudMtime)
                        summary.downloaded += 1
                        continue
                    }
                }

                // Missing mtime on one side.
                // If local exists, keep local as canonical (upload).
                let data = try Data(contentsOf: local)
                let mtime = localMtime ?? Int64(Date().timeIntervalSince1970 * 1000)
                let contentType = guessContentType(name: name)
                Self.debug("upload missing-mtime name=\(name) bytes=\(data.count)")
                _ = try await api.uploadViaBackend(
                    baseURL: baseURL,
                    accessToken: accessToken,
                    name: name,
                    contentType: contentType,
                    bytes: data,
                    mtimeMs: mtime
                )
                summary.uploaded += 1
            }
        }

        Self.debug("sync done uploaded=\(summary.uploaded) downloaded=\(summary.downloaded) skipped=\(summary.skipped)")
        return summary
    }

    // MARK: - Local helpers

    private func localFiles(in dir: URL) throws -> [URL] {
        let files = try fileManager.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )
        return files.filter { url in
            (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
        }
    }

    private func fileMtimeMs(url: URL) throws -> Int64 {
        let vals = try url.resourceValues(forKeys: [.contentModificationDateKey])
        let dt = vals.contentModificationDate ?? Date()
        return Int64(dt.timeIntervalSince1970 * 1000)
    }

    private func setFileMtimeMs(url: URL, mtimeMs: Int64) throws {
        let dt = Date(timeIntervalSince1970: TimeInterval(Double(mtimeMs) / 1000.0))
        try fileManager.setAttributes([.modificationDate: dt], ofItemAtPath: url.path)
    }

    private func guessContentType(name: String) -> String {
        let lower = name.lowercased()
        if lower.hasSuffix(".txt") { return "text/plain" }
        if lower.hasSuffix(".emw") { return "text/plain" }
        if lower.hasSuffix(".json") { return "application/json" }
        return "application/octet-stream"
    }
}
