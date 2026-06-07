/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import SwiftUI

@MainActor
public final class ScriptsViewModel: ObservableObject {
    public enum FileKind: String, Equatable {
        case script
        case library
        case kernel
        case signalRaw
        case signalText

        public var iconSystemName: String {
            switch self {
            case .script:
                // Rendered as a custom EM badge in the UI (see ScriptRow).
                return "doc.text"
            case .library:
                return "books.vertical"
            case .kernel:
                return "cpu"
            case .signalRaw:
                return "waveform.path.ecg"
            case .signalText:
                return "doc.plaintext"
            }
        }

        public var isRunnable: Bool {
            switch self {
            case .script:
                return true
            case .library, .kernel, .signalRaw, .signalText:
                return false
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
        let kind: FileKind
    }

    @Published public private(set) var assetScripts: [ScriptListItem] = []
    @Published public private(set) var customScripts: [ScriptListItem] = []
    @Published public var signalFiles: [ScriptListItem] = []
    @Published public var selectedScriptId: String?
    @Published public var notice: Notice?
    @Published public var isLoading = false
    @Published public var isPerformingAction = false
    @Published public var performingActionText: String? = nil

    private var records: [String: ScriptRecord] = [:]
    private var assetRecords: [String: AssetRecord] = [:]

    private let fileService: FileService
    private let defaults: UserDefaults

    private let scriptExtension = ".emw"
    private let legacyScriptExtension = ".js"
    private let signalRawExtension = ".raw"
    private let signalTextExtension = ".txt"
    private let unsavedKey = "__unsaved__"
    private let lastScriptDefaultsKey = "scripts.last_script_id"

    public init(
        fileService: FileService = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.fileService = fileService
        self.defaults = defaults
        selectedScriptId = defaults.string(forKey: lastScriptDefaultsKey)
        createUnsavedRecordIfNeeded()
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
            let legacyData = try await fileService.listFiles(
                withExtension: legacyScriptExtension,
                includeContent: true,
                accessToken: ""
            )
            mergeRemoteScripts(data + legacyData)

            // Signals are stored under Application Support/signals (sampler library convention).
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

    public func isRunnableScript(_ id: String) -> Bool {
        if let asset = assetRecords[id] {
            return asset.kind.isRunnable
        }
        return records[id]?.metadata != nil || id == unsavedKey
    }

    public func fileKind(for id: String) -> FileKind {
        if let asset = assetRecords[id] {
            return asset.kind
        }
        return records[id]?.metadata.map { _ in .script } ?? .script
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
                addModuleSource(asset.content, name: asset.name, to: &modules)
            }
        }
        for record in records.values {
            guard !record.draftContent.isEmpty else { continue }
            if isModuleScript(name: record.name, content: record.draftContent) {
                addModuleSource(record.draftContent, name: record.name, to: &modules)
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
            updated[filename] = AssetRecord(id: filename, name: filename, content: content, kind: assetKind(for: filename))
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
                return ScriptListItem(id: $0.id, name: $0.name, isDirty: $0.isDirty, isAsset: false, kind: .script, modifiedAt: modifiedAt)
            }
        custom.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        var assets = assetRecords.values.map {
            ScriptListItem(id: $0.id, name: $0.name, isDirty: false, isAsset: true, kind: $0.kind, modifiedAt: nil)
        }
        assets.sort {
            if assetSortRank($0.kind) != assetSortRank($1.kind) {
                return assetSortRank($0.kind) < assetSortRank($1.kind)
            }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }

        customScripts = custom
        assetScripts = assets
    }

    private func isModuleScript(name: String, content: String) -> Bool {
        let lowered = name.lowercased()
        if lowered.hasPrefix("emw-")
            || lowered.hasSuffix(".module.emw")
            || lowered.hasSuffix("_module.emw")
            || lowered.hasSuffix(".module.js")
            || lowered.hasSuffix("_module.js") {
            return true
        }
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.contains("import ") {
            return true
        }
        if normalized.contains("module.exports") {
            return true
        }
        if normalized.contains("exports.") {
            return true
        }
        return false
    }

    private func addModuleSource(_ source: String, name: String, to modules: inout [String: String]) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        modules[trimmed] = source
        if trimmed.lowercased().hasSuffix(scriptExtension) {
            let bare = String(trimmed.dropLast(scriptExtension.count))
            modules[bare] = source
        } else if trimmed.lowercased().hasSuffix(legacyScriptExtension) {
            let bare = String(trimmed.dropLast(legacyScriptExtension.count))
            modules[bare] = source
        }
    }

    private func assetKind(for name: String) -> FileKind {
        let lowered = name.lowercased()
        if lowered == "emw-kernel.emw" || lowered == "emw-protocol.emw" {
            return .kernel
        }
        if lowered.hasPrefix("emw-") {
            return .library
        }
        return .script
    }

    private func assetSortRank(_ kind: FileKind) -> Int {
        switch kind {
        case .script: return 0
        case .library: return 1
        case .kernel: return 2
        case .signalRaw, .signalText: return 3
        }
    }

    private func normalizeScriptName(_ rawName: String) -> String {
        var candidate = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        if candidate.isEmpty {
            candidate = "script_script"
        }
        let lowered = candidate.lowercased()
        if !lowered.hasSuffix(scriptExtension) && !lowered.hasSuffix(legacyScriptExtension) {
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
        "// EMWaver script\n" +
        "import { JSX, render } from \"emw-jsx\";\n" +
        "import { Column, Text, LogViewer } from \"emw-ui\";\n\n" +
        "let logLines = [];\n" +
        "function log(message) {\n" +
        "    const text = String(message);\n" +
        "    logLines.push(text);\n" +
        "    if (logLines.length > 200) {\n" +
        "        logLines.splice(0, logLines.length - 200);\n" +
        "    }\n" +
        "    draw();\n" +
        "}\n\n" +
        "draw();\n\n" +
        "function draw() {\n" +
        "    render(<App />);\n" +
        "}\n\n" +
        "function App() {\n" +
        "    return (\n" +
        "        <Column padding={16} spacing={12}>\n" +
        "            <Text font=\"title2\" fontWeight=\"semibold\">Script Title</Text>\n" +
        "            <Text>Customize this script to add controls and logic.</Text>\n" +
        "            <LogViewer text={logLines.join('\\n')} minHeight={160} padding={{ top: 12, bottom: 12, leading: 12, trailing: 12 }} cornerRadius={8} />\n" +
        "        </Column>\n" +
        "    );\n" +
        "}\n"
    }

    private func showError(message: String) {
        notice = Notice(title: "Error", message: message)
    }

    static func dateFromEtagSeconds(_ etag: String) -> Date? {
        guard let s = Int64(etag.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(s))
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
