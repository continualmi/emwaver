/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

extension ScriptsViewModel {
    func listSignals(withExtension fileExtension: String) async throws -> [UserFileData] {
        let dir = fileService.signalsDirectoryURL()
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let files = try FileManager.default.contentsOfDirectory(
                        at: dir,
                        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey],
                        options: [.skipsHiddenFiles]
                    )

                    var result: [UserFileData] = []
                    for fileURL in files {
                        guard fileURL.isFileURL else { continue }
                        let fileName = fileURL.lastPathComponent
                        if !fileName.hasSuffix(fileExtension) { continue }

                        let attributes = try fileURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
                        let size = Int64(attributes.fileSize ?? 0)
                        let lastModified = attributes.contentModificationDate ?? Date()
                        let etag = String(Int(lastModified.timeIntervalSince1970))

                        let ext = (fileName as NSString).pathExtension
                        let contentType = ext.lowercased() == "raw" ? "application/octet-stream" : "text/plain"

                        let metadata = UserFileMetadata(
                            id: fileName,
                            name: fileName,
                            fileExtension: ext.isEmpty ? "" : ".\(ext)",
                            kind: "file",
                            etag: etag,
                            sizeBytes: size,
                            contentType: contentType
                        )

                        result.append(UserFileData(metadata: metadata, textContent: nil, binaryContent: nil))
                    }

                    continuation.resume(returning: result)
                } catch {
                    continuation.resume(throwing: FileServiceError.fileSystem(error))
                }
            }
        }
    }
}
