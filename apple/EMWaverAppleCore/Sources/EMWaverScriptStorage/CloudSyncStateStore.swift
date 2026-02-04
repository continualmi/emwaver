/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

public final class CloudSyncStateStore {
    public struct Snapshot: Codable, Equatable {
        public let fetchedAtMs: Int64
        public let files: [CloudUserFile]
    }

    private let fileManager = FileManager.default

    public init() {}

    private func snapshotURL(storageDir: URL) -> URL {
        storageDir.appendingPathComponent(".emw_cloud_snapshot.json")
    }

    public func load(storageDir: URL) -> Snapshot? {
        let url = snapshotURL(storageDir: storageDir)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    public func save(storageDir: URL, files: [CloudUserFile]) {
        let url = snapshotURL(storageDir: storageDir)
        let snap = Snapshot(fetchedAtMs: Int64(Date().timeIntervalSince1970 * 1000), files: files)
        guard let data = try? JSONEncoder().encode(snap) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
