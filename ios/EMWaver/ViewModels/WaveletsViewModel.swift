import Foundation
import SwiftUI

@MainActor
final class WaveletsViewModel: ObservableObject {
    struct ScriptListItem: Identifiable, Equatable {
        let id: String
        var name: String
        var isDirty: Bool
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

    @Published private(set) var scripts: [ScriptListItem] = []
    @Published var selectedScriptId: String?
    @Published var notice: Notice?
    @Published var isLoading = false
    @Published var isPerformingAction = false

    private var records: [String: ScriptRecord] = [:]

    private let fileService: FileService
    private let waveletCloudService: WaveletCloudService
    private let defaults: UserDefaults

    private let scriptExtension = ".js"
    private let unsavedKey = "__unsaved__"
    private let lastScriptDefaultsKey = "wavelets.last_script_id"

    init(
        fileService: FileService = .shared,
        waveletCloudService: WaveletCloudService = .shared,
        defaults: UserDefaults = .standard
    ) {
        self.fileService = fileService
        self.waveletCloudService = waveletCloudService
        self.defaults = defaults
        selectedScriptId = defaults.string(forKey: lastScriptDefaultsKey)
        createUnsavedRecordIfNeeded()
        rebuildScriptItems()
    }

    // MARK: - Loading

    func loadScripts(accessToken: String) async {
        guard !accessToken.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let data = try await fileService.listFiles(
                withExtension: scriptExtension,
                includeContent: true,
                accessToken: accessToken
            )
            mergeRemote(data)
            if scripts.isEmpty {
                selectedScriptId = unsavedKey
            } else if let selected = selectedScriptId, records[selected] == nil {
                selectedScriptId = scripts.first?.id
            } else if selectedScriptId == nil {
                selectedScriptId = scripts.first?.id
            }
            if let selected = selectedScriptId {
                defaults.set(selected, forKey: lastScriptDefaultsKey)
            }
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    func syncScripts(accessToken: String) async {
        guard !accessToken.isEmpty else { return }
        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let data = try await fileService.listFiles(
                withExtension: scriptExtension,
                includeContent: true,
                accessToken: accessToken
            )
            mergeRemote(data)
            if let selected = selectedScriptId {
                defaults.set(selected, forKey: lastScriptDefaultsKey)
            }
            showInfo(title: "Sync Complete", message: "Scripts updated from cloud")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    // MARK: - Accessors

    func scriptName(for id: String) -> String {
        records[id]?.name ?? "Unsaved Script"
    }

    var unsavedIdentifier: String { unsavedKey }

    func scriptDraft(for id: String) -> String {
        records[id]?.draftContent ?? ""
    }

    func isScriptDirty(_ id: String) -> Bool {
        records[id]?.isDirty ?? false
    }

    func isExistingScript(_ id: String) -> Bool {
        records[id]?.metadata != nil
    }

    func draftBinding(for id: String) -> Binding<String> {
        Binding(
            get: { [weak self] in self?.scriptDraft(for: id) ?? "" },
            set: { [weak self] newValue in self?.updateDraft(for: id, content: newValue) }
        )
    }

    func moduleSources() -> [String: String] {
        var modules: [String: String] = [:]
        for record in records.values {
            guard !record.draftContent.isEmpty else { continue }
            if isModuleScript(name: record.name, content: record.draftContent) {
                modules[record.name] = record.draftContent
            }
        }
        return modules
    }

    func updateDraft(for id: String, content: String) {
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

    func ensureContent(for id: String, accessToken: String) async {
        guard var record = records[id], record.remoteContent == nil, let metadata = record.metadata else {
            return
        }
        do {
            let data = try await fileService.getFile(id: metadata.id, accessToken: accessToken)
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

    func saveScript(id: String, accessToken: String) async {
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
                accessToken: accessToken
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

    func createScript(name rawName: String, accessToken: String) async -> String? {
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName))
        let content = scriptDraft(for: unsavedKey)

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let metadata = try await fileService.createTextFile(name: normalized, content: content, accessToken: accessToken)
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

    func renameScript(id: String, newName rawName: String, accessToken: String) async {
        guard var record = records[id], let metadata = record.metadata else { return }
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName), excluding: id)

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let updatedMetadata = try await fileService.renameFile(id: metadata.id, name: normalized, accessToken: accessToken)
            record.metadata = updatedMetadata
            record.name = updatedMetadata.name
            records[id] = record
            rebuildScriptItems()
            showInfo(title: "Renamed", message: "Script renamed to \(updatedMetadata.name)")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    func deleteScript(id: String, accessToken: String) async {
        guard let record = records[id], let metadata = record.metadata else { return }

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            try await fileService.deleteFile(id: metadata.id, etag: metadata.etag, accessToken: accessToken)
            records.removeValue(forKey: id)
            if selectedScriptId == id {
                selectedScriptId = scripts.first(where: { records[$0.id]?.metadata != nil })?.id ?? unsavedKey
                defaults.set(selectedScriptId, forKey: lastScriptDefaultsKey)
            }
            rebuildScriptItems()
            showInfo(title: "Deleted", message: "Script deleted")
        } catch {
            showError(message: error.localizedDescription)
        }
    }

    func copyScript(id: String, newName rawName: String, accessToken: String) async -> String? {
        guard let record = records[id], let metadata = record.metadata else { return nil }
        let normalized = resolveUniqueScriptName(normalizeScriptName(rawName))
        let content = record.draftContent

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let newMetadata = try await fileService.copyFile(sourceId: metadata.id, name: normalized, accessToken: accessToken)
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

    func importWavelet(
        wavelet: IRDBImportedWavelet,
        accessToken: String
    ) async {
        let normalized = resolveUniqueScriptName(normalizeScriptName(wavelet.name))

        isPerformingAction = true
        defer { isPerformingAction = false }

        do {
            let metadata = try await fileService.createTextFile(name: normalized, content: wavelet.content, accessToken: accessToken)
            let id = metadata.id
            let record = ScriptRecord(
                id: id,
                metadata: metadata,
                name: metadata.name,
                draftContent: wavelet.content,
                remoteContent: wavelet.content,
                remoteEtag: metadata.etag,
                isDirty: false
            )
            records[id] = record
            rebuildScriptItems()
            selectedScriptId = id
            defaults.set(id, forKey: lastScriptDefaultsKey)
            showInfo(title: "Wavelet Imported", message: metadata.name)

            Task {
                do {
                    try await waveletCloudService.uploadWavelet(
                        name: metadata.name,
                        content: wavelet.content,
                        metadataJSON: wavelet.metadataJSON,
                        accessToken: accessToken
                    )
                } catch {
                    await MainActor.run {
                        self.showError(message: "Wavelet imported but failed to sync to cloud")
                    }
                }
            }
        } catch {
            showError(message: error.localizedDescription)
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

        // Preserve unsaved draft if it exists and has content
        if let unsaved = records[unsavedKey], !unsaved.draftContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            updated[unsavedKey] = unsaved
        } else {
            updated[unsavedKey] = makeUnsavedRecord()
        }

        let existing = records

        for entry in data {
            let metadata = entry.metadata
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
        var items: [ScriptListItem] = records.values
            .filter { $0.metadata != nil }
            .map { ScriptListItem(id: $0.id, name: $0.name, isDirty: $0.isDirty) }
        items.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        scripts = items
    }

    private func isModuleScript(name: String, content: String) -> Bool {
        let lowered = name.lowercased()
        if lowered.hasSuffix(".module.js") || lowered.hasSuffix("_module.js") {
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
        "WaveletConsole.subscribe(render);\n" +
        "render();\n\n" +
        "function render() {\n" +
        "    UI.render(UI.column({\n" +
        "        padding: 16,\n" +
        "        spacing: 12,\n" +
        "        children: [\n" +
        "            UI.text({ text: 'Wavelet Title', font: 'title2', fontWeight: 'semibold' }),\n" +
        "            UI.text({ text: 'Customize this script to add controls and logic.', foregroundColor: '#6B7280' }),\n" +
        "            WaveletConsole.view({ minHeight: 160, backgroundColor: '#111827', foregroundColor: '#F9FAFB', padding: { top: 12, bottom: 12, leading: 12, trailing: 12 }, cornerRadius: 8 })\n" +
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
}
