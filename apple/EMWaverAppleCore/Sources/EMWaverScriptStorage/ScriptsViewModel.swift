/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import SwiftUI
import os

@MainActor
public final class ScriptsViewModel: ObservableObject {
    private static let log = OSLog(subsystem: "com.emwaver", category: "Sync")
    public enum FileKind: String, Equatable {
        case script
        case signalRaw
        case signalText

        public var iconSystemName: String {
            switch self {
            case .script:
                // Rendered as a custom EM badge in the UI (see ScriptRow).
                return "doc.text"
            case .signalRaw:
                return "waveform.path.ecg"
            case .signalText:
                return "doc.plaintext"
            }
        }
    }

    public enum SyncStatus: String, Equatable {
        case synced
        case localNewer
        case cloudNewer
        case localOnly
        case unknown

        public var iconSystemName: String {
            switch self {
            case .synced: return "checkmark.circle"
            case .localNewer: return "arrow.up.circle"
            case .cloudNewer: return "arrow.down.circle"
            case .localOnly: return "circle.dashed"
            case .unknown: return "questionmark.circle"
            }
        }
    }

    public struct ScriptListItem: Identifiable, Equatable {
        public let id: String
        public var name: String
        public var isDirty: Bool
        public var isAsset: Bool
        public var kind: FileKind
        public var modifiedAt: Date?
        public var syncStatus: SyncStatus
    }

    public struct Notice: Identifiable {
        public let id = UUID()
        public let title: String
        public let message: String
    }

    private struct ScriptRecord {
        let id: String
        var metadata: UserFileMetadata?
        var name: String
        var draftContent: String
        var remoteContent: String?
        var remoteEtag: String?
        var isDirty: Bool
    }

    private struct AssetRecord {
        let id: String
        let name: String
        let content: String
    }

    @Published public private(set) var assetScripts: [ScriptListItem] = []
    @Published public private(set) var customScripts: [ScriptListItem] = []
    @Published public var signalFiles: [ScriptListItem] = []
    @Published public private(set) var cloudFilesByName: [String: CloudUserFile] = [:]
    @Published public var selectedScriptId: String?
    @Published public var notice: Notice?
    @Published public var isLoading = false
    @Published public var isPerformingAction = false
    @Published public var performingActionText: String? = nil

    private var records: [String: ScriptRecord] = [:]
    private var assetRecords: [String: AssetRecord] = [:]

    private let fileService: FileService
    private let defaults: UserDefaults
    private let syncEngine = CloudSyncEngine()
    private let cloudStateStore = CloudSyncStateStore()

    private let scriptExtension = ".emw"
    private let signalRawExtension = ".raw"
    private let signalTextExtension = ".txt"
    private let unsavedKey = "__unsaved__"
    private let lastScriptDefaultsKey = "scripts.last_script_id"
    private let assetIdPrefix = "__asset__"

    public init(
        fileService: FileService = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.fileService = fileService
        self.defaults = defaults
        selectedScriptId = defaults.string(forKey: lastScriptDefaultsKey)
        createUnsavedRecordIfNeeded()

        // Load last known cloud snapshot (for main-screen badges) if present.
        if let snap = cloudStateStore.load(storageDir: fileService.storageDirectoryURL()) {
            cloudFilesByName = Dictionary(snap.files.map { ($0.name, $0) }, uniquingKeysWith: { a, b in b })
        }

        rebuildScriptItems()
    }

    public func loadScripts() async {
        isLoading = true
        defer { isLoading = false }

        loadAssetScriptsFromBundle()

        do {
            let data = try await fileService.listFiles(
                withExtension: scriptExtension,
                includeContent: true,
                accessToken: ""
            )
            mergeRemoteScripts(data)

            // Signals are stored under Application Support/signals (sampler.emw convention).
            let raw = try await fileService.listSignalFiles(withExtension: signalRawExtension, includeContent: false, accessToken: "")
            let txt = try await fileService.listSignalFiles(withExtension: signalTextExtension, includeContent: false, accessToken: "")
            mergeRemoteSignals(raw + txt)

            let allScripts = assetScripts + customScripts
            if allScripts.isEmpty {
                selectedScriptId = unsavedKey
            } else if let selected = selectedScriptId, !isValidSelection(selected) {
                selectedScriptId = allScripts.first?.id
            } else if selectedScriptId == nil {
                selectedScriptId = allScripts.first?.id
            }
            if let selected = selectedScriptId {
                defaults.set(selected, forKey: lastScriptDefaultsKey)
            }
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    public func sync(baseURL: URL, accessToken: String) async {
        isPerformingAction = true
        performingActionText = "Preparing sync…"
        defer {
            isPerformingAction = false
            performingActionText = nil
        }

        let debug = true
        if debug {
            os_log("%{public}@", log: Self.log, type: .fault, "[Sync] begin baseURL=\(baseURL.absoluteString) tokenLen=\(accessToken.count)")
        }

        do {
            // All user files live in Documents/scripts on macOS.
            let scriptsDir = fileService.storageDirectoryURL()
            if debug { os_log("%{public}@", log: Self.log, type: .fault, "[Sync] dir=\(scriptsDir.path)") }

            performingActionText = "Syncing scripts…"
            let s = try await syncEngine.sync(
                baseURL: baseURL,
                accessToken: accessToken,
                storageDir: scriptsDir
            )

            // Refresh cloud snapshot for badges (name -> mtime_ms).
            do {
                let cloud = try await CloudFilesAPI().listFiles(baseURL: baseURL, accessToken: accessToken)
                cloudStateStore.save(storageDir: scriptsDir, files: cloud)
                cloudFilesByName = Dictionary(cloud.map { ($0.name, $0) }, uniquingKeysWith: { a, b in b })
            } catch {
                os_log("%{public}@", log: Self.log, type: .fault, "[Sync] failed to refresh cloud snapshot: \(error)")
            }

            await loadScripts()
            if debug {
                os_log("%{public}@", log: Self.log, type: .fault, "[Sync] done uploaded=\(s.uploaded) downloaded=\(s.downloaded) skipped=\(s.skipped)")
            }
            showInfo(
                title: "Sync complete",
                message: "Uploaded: \(s.uploaded), Downloaded: \(s.downloaded), Skipped: \(s.skipped)"
            )
        } catch {
            if debug {
                os_log("%{public}@", log: Self.log, type: .fault, "[Sync] error: \(String(describing: error))")
            }
            showError(message: error.localizedDescription)
        }
    }

    public func scriptName(for id: String) -> String {
        if let asset = assetRecords[id] {
            return asset.name
        }
        return records[id]?.name ?? "Unsaved Script"
    }

    public var unsavedIdentifier: String { unsavedKey }

    public func scriptDraft(for id: String) -> String {
        if let asset = assetRecords[id] {
            return asset.content
        }
        return records[id]?.draftContent ?? ""
    }

    public func isScriptDirty(_ id: String) -> Bool {
        if assetRecords[id] != nil {
            return false
        }
        return records[id]?.isDirty ?? false
    }

    public func isExistingScript(_ id: String) -> Bool {
        if assetRecords[id] != nil {
            return true
        }
        return records[id]?.metadata != nil
    }

    public func isAssetScript(_ id: String) -> Bool {
        assetRecords[id] != nil
    }

    public func updateDraft(for id: String, content: String) {
        if assetRecords[id] != nil {
            return
        }
        var record = ensureRecord(id: id)
        record.draftContent = content
        if let remote = record.remoteContent {
            record.isDirty = remote != content
        } else {
            record.isDirty = true
        }
        records[id] = record
        rebuildScriptItems()
    }

    public func ensureContent(for id: String) async {
        if assetRecords[id] != nil {
            return
        }
        guard var record = records[id], record.remoteContent == nil, let metadata = record.metadata else {
            return
        }
        do {
            let data = try await fileService.getFile(id: metadata.id, accessToken: "")
            let text = data.textContent ?? ""
            record.remoteContent = text
            record.remoteEtag = data.metadata.etag
            if !record.isDirty {
                record.draftContent = text
            }
            records[id] = record
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    public func saveScript(id: String) async {
        if assetRecords[id] != nil {
            notice = Notice(title: "Read-Only", message: "Asset scripts cannot be modified. Create a copy to edit.")
            return
        }
        guard var record = records[id] else { return }

        if record.metadata == nil {
            showError(message: "Script name required before saving")
            return
        }

        guard let metadata = record.metadata, let etag = metadata.etag, record.isDirty else {
            notice = Notice(title: "No Changes", message: "There are no changes to save")
            return
        }

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let updatedMetadata = try await fileService.updateTextFile(
                id: metadata.id,
                etag: etag,
                content: record.draftContent,
                accessToken: ""
            )
            record.metadata = updatedMetadata
            record.remoteEtag = updatedMetadata.etag
            record.remoteContent = record.draftContent
            record.name = updatedMetadata.name
            record.isDirty = false
            records[id] = record
            rebuildScriptItems()
            showInfo(title: "Saved", message: "Script saved successfully")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    public func createScript(name rawName: String) async -> String? {
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName))
        let content = scriptDraft(for: unsavedKey)

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let metadata = try await fileService.createTextFile(name: normalized, content: content, accessToken: "")
            let id = metadata.id
            let record = ScriptRecord(
                id: id,
                metadata: metadata,
                name: metadata.name,
                draftContent: content,
                remoteContent: content,
                remoteEtag: metadata.etag,
                isDirty: false
            )
            records[id] = record
            resetUnsavedRecord()
            rebuildScriptItems()
            selectedScriptId = id
            defaults.set(id, forKey: lastScriptDefaultsKey)
            showInfo(title: "Script Created", message: "Saved as \(metadata.name)")
            return id
        } catch {
            showError(message: error.localizedDescription)
            return nil
        }
    }

    public func renameScript(id: String, newName rawName: String) async {
        if assetRecords[id] != nil {
            notice = Notice(title: "Read-Only", message: "Asset scripts cannot be renamed. Create a copy to edit.")
            return
        }
        guard var record = records[id], let metadata = record.metadata else { return }
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName), excluding: id)

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let updatedMetadata = try await fileService.renameFile(id: metadata.id, name: normalized, accessToken: "")
            record.metadata = updatedMetadata
            record.name = updatedMetadata.name
            records[id] = record
            rebuildScriptItems()
            showInfo(title: "Renamed", message: "Script renamed to \(updatedMetadata.name)")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    public func deleteScript(id: String) async {
        if assetRecords[id] != nil {
            notice = Notice(title: "Read-Only", message: "Asset scripts cannot be deleted.")
            return
        }
        guard let record = records[id], let metadata = record.metadata else { return }

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            try await fileService.deleteFile(id: metadata.id, etag: metadata.etag, accessToken: "")
            records.removeValue(forKey: id)
            if selectedScriptId == id {
                let allScripts = assetScripts + customScripts
                selectedScriptId = allScripts.first?.id ?? unsavedKey
                defaults.set(selectedScriptId, forKey: lastScriptDefaultsKey)
            }
            rebuildScriptItems()
            showInfo(title: "Deleted", message: "Script deleted")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    public func copyScript(id: String, newName rawName: String) async -> String? {
        let content: String
        if let asset = assetRecords[id] {
            content = asset.content
        } else if let record = records[id] {
            content = record.draftContent
        } else {
            return nil
        }
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName))

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let newMetadata = try await fileService.createTextFile(name: normalized, content: content, accessToken: "")
            let newId = newMetadata.id
            let newRecord = ScriptRecord(
                id: newId,
                metadata: newMetadata,
                name: newMetadata.name,
                draftContent: content,
                remoteContent: content,
                remoteEtag: newMetadata.etag,
                isDirty: false
            )
            records[newId] = newRecord
            rebuildScriptItems()
            selectedScriptId = newId
            defaults.set(newId, forKey: lastScriptDefaultsKey)
            showInfo(title: "Copied", message: "Script copied to \(newMetadata.name)")
            return newId
        } catch {
            showError(message: error.localizedDescription)
            return nil
        }
    }

    public func selectScript(id: String?) {
        selectedScriptId = id
        if let id {
            defaults.set(id, forKey: lastScriptDefaultsKey)
        }
    }

    public func moduleSources() -> [String: String] {
        var modules: [String: String] = [:]
        for asset in assetRecords.values {
            guard !asset.content.isEmpty else { continue }
            if isModuleScript(name: asset.name, content: asset.content) {
                modules[asset.name] = asset.content
            }
        }
        for record in records.values {
            guard !record.draftContent.isEmpty else { continue }
            if isModuleScript(name: record.name, content: record.draftContent) {
                modules[record.name] = record.draftContent
            }
        }
        return modules
    }

    private func mergeRemoteScripts(_ data: [UserFileData]) {
        var updated: [String: ScriptRecord] = [:]
        let assetNameSet = Set(assetRecords.values.map { $0.name.lowercased() })

        if let unsaved = records[unsavedKey], !unsaved.draftContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            updated[unsavedKey] = unsaved
        } else {
            updated[unsavedKey] = makeUnsavedRecord()
        }

        let existing = records

        for entry in data {
            let metadata = entry.metadata
            if assetNameSet.contains(metadata.name.lowercased()) {
                continue
            }
            let id = metadata.id
            let remoteContent = entry.textContent ?? ""
            var record = existing[id] ?? ScriptRecord(
                id: id,
                metadata: metadata,
                name: metadata.name,
                draftContent: remoteContent,
                remoteContent: remoteContent,
                remoteEtag: metadata.etag,
                isDirty: false
            )

            record.metadata = metadata
            record.name = metadata.name
            record.remoteContent = remoteContent
            record.remoteEtag = metadata.etag
            if !record.isDirty {
                record.draftContent = remoteContent
            }
            updated[id] = record
        }

        records = updated
        rebuildScriptItems()
    }

    private func loadAssetScriptsFromBundle() {
        var updated: [String: AssetRecord] = [:]
        let urls = Bundle.main.urls(forResourcesWithExtension: "emw", subdirectory: "DefaultScripts") ?? []
        for fileUrl in urls {
            let filename = fileUrl.lastPathComponent
            guard let content = try? String(contentsOf: fileUrl, encoding: .utf8) else {
                continue
            }
            let id = assetIdPrefix + filename
            updated[id] = AssetRecord(id: id, name: filename, content: content)
        }
        assetRecords = updated
        rebuildScriptItems()
    }

    private func ensureRecord(id: String) -> ScriptRecord {
        if let record = records[id] {
            return record
        }
        if id == unsavedKey {
            let unsaved = makeUnsavedRecord()
            records[id] = unsaved
            rebuildScriptItems()
            return unsaved
        }
        let placeholder = ScriptRecord(
            id: id,
            metadata: nil,
            name: "Unsaved Script",
            draftContent: defaultTemplate(),
            remoteContent: nil,
            remoteEtag: nil,
            isDirty: true
        )
        records[id] = placeholder
        rebuildScriptItems()
        return placeholder
    }

    private func createUnsavedRecordIfNeeded() {
        if records[unsavedKey] == nil {
            records[unsavedKey] = makeUnsavedRecord()
        }
    }

    private func makeUnsavedRecord() -> ScriptRecord {
        ScriptRecord(
            id: unsavedKey,
            metadata: nil,
            name: "Unsaved Script",
            draftContent: defaultTemplate(),
            remoteContent: nil,
            remoteEtag: nil,
            isDirty: false
        )
    }

    private func resetUnsavedRecord() {
        records[unsavedKey] = makeUnsavedRecord()
        rebuildScriptItems()
    }

    private func rebuildScriptItems() {
        var custom: [ScriptListItem] = records.values
            .filter { $0.metadata != nil }
            .map {
                let modifiedAt = $0.metadata?.etag.flatMap { Self.dateFromEtagSeconds($0) }
                let syncStatus = computeSyncStatus(name: $0.name, localModifiedAt: modifiedAt)
                return ScriptListItem(id: $0.id, name: $0.name, isDirty: $0.isDirty, isAsset: false, kind: .script, modifiedAt: modifiedAt, syncStatus: syncStatus)
            }
        custom.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        var assets = assetRecords.values.map {
            ScriptListItem(id: $0.id, name: $0.name, isDirty: false, isAsset: true, kind: .script, modifiedAt: nil, syncStatus: .unknown)
        }
        assets.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        customScripts = custom
        assetScripts = assets
    }

    private func isModuleScript(name: String, content: String) -> Bool {
        let lowered = name.lowercased()
        if lowered.hasSuffix(".module.emw") || lowered.hasSuffix("_module.emw") {
            return true
        }
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.contains("module.exports") {
            return true
        }
        if normalized.contains("exports.") {
            return true
        }
        return false
    }

    private func normalizeScriptName(_ rawName: String) -> String {
        var candidate = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if candidate.isEmpty {
            candidate = "script_script"
        }
        if !candidate.lowercased().hasSuffix(scriptExtension) {
            candidate += scriptExtension
        }
        return candidate
    }

    private func resolveUniqueScriptName(_ proposed: String, excluding excludeId: String? = nil) -> String {
        let existingNames = Set(records.values
            .filter { $0.id != excludeId }
            .map { $0.name.lowercased() })
            .union(assetRecords.values.map { $0.name.lowercased() })

        if !existingNames.contains(proposed.lowercased()) {
            return proposed
        }

        let dotIndex = proposed.lastIndex(of: ".") ?? proposed.endIndex
        let base = String(proposed[..<dotIndex])
        let ext = String(proposed[dotIndex...])
        var counter = 1
        var candidate = "\(base)_\(counter)\(ext)"
        while existingNames.contains(candidate.lowercased()) {
            counter += 1
            candidate = "\(base)_\(counter)\(ext)"
        }
        return candidate
    }

    private func defaultTemplate() -> String {
        "// Script script\n" +
        "let logLines = [];\n" +
        "const nativePrint = print;\n\n" +
        "function log(message) {\n" +
        "    const text = String(message);\n" +
        "    logLines.push(text);\n" +
        "    if (logLines.length > 200) {\n" +
        "        logLines.splice(0, logLines.length - 200);\n" +
        "    }\n" +
        "    nativePrint(text);\n" +
        "    render();\n" +
        "}\n\n" +
        "render();\n\n" +
        "function render() {\n" +
        "    UI.render(UI.column({\n" +
        "        padding: 16,\n" +
        "        spacing: 12,\n" +
        "        children: [\n" +
        "            UI.text({ text: 'Script Title', font: 'title2', fontWeight: 'semibold' }),\n" +
        "            UI.text({ text: 'Customize this script to add controls and logic.' }),\n" +
        "            UI.logViewer({ text: logLines.join('\\n'), minHeight: 160, padding: { top: 12, bottom: 12, leading: 12, trailing: 12 }, cornerRadius: 8 })\n" +
        "        ]\n" +
        "    }));\n" +
        "}\n"
    }

    private func showError(message: String) {
        notice = Notice(title: "Error", message: message)
    }

    static func dateFromEtagSeconds(_ etag: String) -> Date? {
        guard let s = Int64(etag.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(s))
    }

    func computeSyncStatus(name: String, localModifiedAt: Date?) -> SyncStatus {
        // We only know cloud state if we've synced at least once (snapshot loaded).
        guard let cloud = cloudFilesByName[name] else {
            return .localOnly
        }
        guard let localModifiedAt else {
            return .unknown
        }
        guard let cloudMtimeMs = cloud.mtimeMs else {
            return .unknown
        }

        let localMs = Int64(localModifiedAt.timeIntervalSince1970 * 1000)
        if localMs == cloudMtimeMs {
            return .synced
        }
        return localMs > cloudMtimeMs ? .localNewer : .cloudNewer
    }

    private func showInfo(title: String, message: String) {
        notice = Notice(title: title, message: message)
    }

    private func isValidSelection(_ id: String) -> Bool {
        if assetRecords[id] != nil {
            return true
        }
        return records[id] != nil
    }
}
