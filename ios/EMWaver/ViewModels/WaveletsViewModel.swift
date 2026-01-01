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
import SwiftUI

@MainActor
final class WaveletsViewModel: ObservableObject {
    struct ScriptListItem: Identifiable, Equatable {
        let id: String
        var name: String
        var isDirty: Bool
        var isAsset: Bool
    }

    struct Notice: Identifiable {
        let id = UUID()
        let title: String
        let message: String
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

    @Published private(set) var assetScripts: [ScriptListItem] = []
    @Published private(set) var customScripts: [ScriptListItem] = []
    @Published var selectedScriptId: String?
    @Published var notice: Notice?
    @Published var isLoading = false
    @Published var isPerformingAction = false

    private var records: [String: ScriptRecord] = [:]
    private var assetRecords: [String: AssetRecord] = [:]

    private let fileService: FileService
    private let defaults: UserDefaults

    private let scriptExtension = ".js"
    private let unsavedKey = "__unsaved__"
    private let lastScriptDefaultsKey = "wavelets.last_script_id"
    private let assetIdPrefix = "__asset__"
    private let assetScriptNames = [
        "cc1101.emw",
        "gpio.emw",
        "ir_send_saved_signal.emw",
        "rfm69.emw",
        "usb.emw",
        "wavelet_demo.emw"
    ]

    init(
        fileService: FileService = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.fileService = fileService
        self.defaults = defaults
        selectedScriptId = defaults.string(forKey: lastScriptDefaultsKey)
        createUnsavedRecordIfNeeded()
        rebuildScriptItems()
    }

    // MARK: - Loading

    func loadScripts() async {
        isLoading = true
        defer { isLoading = false }

        loadAssetScriptsFromBundle()

        do {
            let data = try await fileService.listFiles(
                withExtension: scriptExtension,
                includeContent: true,
                accessToken: ""
            )
            mergeRemote(data)

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

    // MARK: - Accessors

    func scriptName(for id: String) -> String {
        if let asset = assetRecords[id] {
            return asset.name
        }
        return records[id]?.name ?? "Unsaved Script"
    }

    var unsavedIdentifier: String { unsavedKey }

    func scriptDraft(for id: String) -> String {
        if let asset = assetRecords[id] {
            return asset.content
        }
        return records[id]?.draftContent ?? ""
    }

    func isScriptDirty(_ id: String) -> Bool {
        if assetRecords[id] != nil {
            return false
        }
        return records[id]?.isDirty ?? false
    }

    func isExistingScript(_ id: String) -> Bool {
        if assetRecords[id] != nil {
            return true
        }
        return records[id]?.metadata != nil
    }

    func isAssetScript(_ id: String) -> Bool {
        assetRecords[id] != nil
    }

    func draftBinding(for id: String) -> Binding<String> {
        Binding(
            get: { [weak self] in self?.scriptDraft(for: id) ?? "" },
            set: { [weak self] newValue in self?.updateDraft(for: id, content: newValue) }
        )
    }

    func moduleSources() -> [String: String] {
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

    func updateDraft(for id: String, content: String) {
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

    func ensureContent(for id: String) async {
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

    // MARK: - CRUD

    func saveScript(id: String) async {
        if assetRecords[id] != nil {
            notice = Notice(title: "Read-Only", message: "Asset scripts cannot be modified. Create a copy to edit.")
            return
        }
        guard var record = records[id] else { return }

        if record.metadata == nil {
            // requires creation with explicit name
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

    func createScript(name rawName: String) async -> String? {
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

    func renameScript(id: String, newName rawName: String) async {
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

    func deleteScript(id: String) async {
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

    func copyScript(id: String, newName rawName: String) async -> String? {
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


    // MARK: - Selection

    func selectScript(id: String?) {
        selectedScriptId = id
        if let id {
            defaults.set(id, forKey: lastScriptDefaultsKey)
        }
    }

    // MARK: - Helpers

    private func mergeRemote(_ data: [UserFileData]) {
        var updated: [String: ScriptRecord] = [:]
        let assetNameSet = Set(assetScriptNames.map { $0.lowercased() })

        // Preserve unsaved draft if it exists and has content
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

        for filename in assetScriptNames {
            let nameWithoutExt = filename.replacingOccurrences(of: ".emw", with: "")
            var url = Bundle.main.url(forResource: nameWithoutExt, withExtension: "emw", subdirectory: "DefaultScripts")
            if url == nil {
                url = Bundle.main.url(forResource: nameWithoutExt, withExtension: "emw")
            }
            guard let fileUrl = url,
                  let content = try? String(contentsOf: fileUrl, encoding: .utf8) else {
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
            .map { ScriptListItem(id: $0.id, name: $0.name, isDirty: $0.isDirty, isAsset: false) }
        custom.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        var assets = assetRecords.values.map {
            ScriptListItem(id: $0.id, name: $0.name, isDirty: false, isAsset: true)
        }
        assets.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        customScripts = custom
        assetScripts = assets
    }

    private func isModuleScript(name: String, content: String) -> Bool {
        let lowered = name.lowercased()
        if lowered.hasSuffix(".module.js")
            || lowered.hasSuffix("_module.js")
            || lowered.hasSuffix(".module.emw")
            || lowered.hasSuffix("_module.emw") {
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
            candidate = "wavelet_script"
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
            .union(assetScriptNames.map { $0.lowercased() })

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
        "// Wavelet script\n" +
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
        "            UI.text({ text: 'Wavelet Title', font: 'title2', fontWeight: 'semibold' }),\n" +
        "            UI.text({ text: 'Customize this script to add controls and logic.', foregroundColor: '#6B7280' }),\n" +
        "            UI.logViewer({ text: logLines.join('\\n'), minHeight: 160, backgroundColor: '#111827', foregroundColor: '#F9FAFB', padding: { top: 12, bottom: 12, leading: 12, trailing: 12 }, cornerRadius: 8 })\n" +
        "        ]\n" +
        "    }));\n" +
        "}\n"
    }

    private func showError(message: String) {
        notice = Notice(title: "Error", message: message)
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
