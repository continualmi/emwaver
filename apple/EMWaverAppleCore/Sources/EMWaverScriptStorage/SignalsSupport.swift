/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

extension ScriptsViewModel {
    struct SignalRecord {
        let id: String
        let name: String
        let ext: String
        let sizeBytes: Int64
        let etag: String
    }

    func mergeRemoteSignals(_ data: [UserFileData]) {
        var signals: [ScriptListItem] = []
        for entry in data {
            let name = entry.metadata.name
            let ext = entry.metadata.fileExtension
            let kind: FileKind
            if ext.lowercased() == ".raw" {
                kind = .signalRaw
            } else {
                kind = .signalText
            }
            let modifiedAt = entry.metadata.etag.flatMap { ScriptsViewModel.dateFromEtagSeconds($0) }
            signals.append(ScriptListItem(id: entry.metadata.id, name: name, isDirty: false, isAsset: false, kind: kind, modifiedAt: modifiedAt, syncStatus: .localOnly))
        }
        signals.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        signalFiles = signals
    }
}
