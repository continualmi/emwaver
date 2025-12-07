import SwiftUI
import Foundation
import DGCharts

@MainActor
final class SamplerViewModel: ObservableObject {
    struct SaveButtonState {
        let title: String
        let isEnabled: Bool
    }

    struct SignalListItem: Identifiable, Equatable {
        let metadata: UserFileMetadata
        let isActive: Bool
        let isDirty: Bool

        var id: String { metadata.id }
        var name: String { metadata.name }

        var sizeDescription: String {
            let bytes = metadata.sizeBytes
            if bytes <= 0 { return "Size unknown" }
            if bytes < 1024 {
                return "\(bytes) bytes"
            }
            if bytes < 1024 * 1024 {
                return String(format: "%.1f KB", Double(bytes) / 1024.0)
            }
            return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
        }
    }

    struct Notice: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    @Published var visibleRangeStart: Double = 0
    @Published var visibleRangeEnd: Double = 10000
    @Published private(set) var signals: [SignalListItem] = []
    @Published private(set) var isLoadingSignals = false
    @Published private(set) var isSavingSignal = false
    @Published private(set) var currentSignalMetadata: UserFileMetadata?
    @Published private(set) var currentSignalName: String = SamplerViewModel.defaultSignalName
    @Published private(set) var hasUnsavedChanges = false
    @Published var outputText: String = ""
    @Published private(set) var isDecoding = false
    @Published private(set) var isRendering = false
    @Published var notice: Notice?

    private var bleManager: BLEManager?
    private let settingsManager = SettingsManager.shared

    static var defaultSignalName: String { "capture.raw" }

    var refreshTime: Int { settingsManager.refreshTime }
    var bufferSizeLimit: Int { settingsManager.bufferSizeLimit }

    func attachBLEManager(_ manager: BLEManager) {
        bleManager = manager
    }

    func isBufferSizeLimitReached(isRecording: Bool) -> Bool {
        guard isRecording, bufferSizeLimit > 0, let buffer = bleManager?.getBuffer() else { return false }
        return buffer.count >= bufferSizeLimit
    }

    func setVisibleRangeStart(_ range: Double) {
        visibleRangeStart = range
    }

    func setVisibleRangeEnd(_ range: Double) {
        visibleRangeEnd = range
    }

    func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) -> [ChartDataEntry] {
        guard let bleManager else { return [] }

        let bufferData = bleManager.getBuffer()
        let totalBits = bufferData.count * 8
        guard totalBits > 0 else { return [] }

        let clampedStart = max(0, Int(rangeStart.rounded()))
        let clampedEnd = min(totalBits, Int(rangeEnd.rounded()))
        let effectiveEnd = max(clampedStart, clampedEnd)
        let numberBins = 500

        let (timeValues, dataValues) = bleManager.compressDataBits(
            rangeStart: clampedStart,
            rangeEnd: effectiveEnd,
            numberBins: numberBins
        )

        return timeValues.enumerated().compactMap { index, time in
            guard index < dataValues.count else { return nil }
            return ChartDataEntry(x: Double(time), y: Double(dataValues[index]))
        }
    }

    // MARK: - Signal Management

    func markBufferDirty(resetMetadata: Bool, suggestedName: String?) {
        if resetMetadata {
            currentSignalMetadata = nil
        }
        if let suggested = suggestedName, !suggested.isEmpty {
            currentSignalName = normalizeSignalName(suggested)
        } else if resetMetadata, currentSignalName.isEmpty {
            currentSignalName = Self.defaultSignalName
        }
        hasUnsavedChanges = true
        refreshSignalListBindings()
    }

    func markBufferClean(with metadata: UserFileMetadata?) {
        if let metadata {
            currentSignalMetadata = metadata
            currentSignalName = metadata.name
        }
        hasUnsavedChanges = false
        refreshSignalListBindings()
    }

    func normalizeSignalName(_ raw: String) -> String {
        var name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            name = "signal.raw"
        }
        if !name.lowercased().hasSuffix(".raw") {
            name.append(".raw")
        }
        return name
    }

    func generateNewSignalName() -> String {
        let existing = Set(signals.map { $0.name.lowercased() })
        var counter = 1
        var candidate = "signal\(counter).raw"
        while existing.contains(candidate.lowercased()) {
            counter += 1
            candidate = "signal\(counter).raw"
        }
        return candidate
    }

    func saveButtonState(isAuthenticated: Bool) -> SaveButtonState {
        if isSavingSignal {
            return SaveButtonState(title: "Saving...", isEnabled: false)
        }
        guard isAuthenticated else {
            return SaveButtonState(title: "Sign in to save", isEnabled: false)
        }
        if currentSignalMetadata == nil {
            return SaveButtonState(title: "Save to Cloud", isEnabled: hasUnsavedChanges)
        }
        if hasUnsavedChanges {
            return SaveButtonState(title: "Save Changes", isEnabled: true)
        }
        return SaveButtonState(title: "Synced", isEnabled: false)
    }

    func currentSignalSummary() -> String {
        var summary = "Current signal: \(currentSignalName.isEmpty ? Self.defaultSignalName : currentSignalName)"
        if hasUnsavedChanges {
            summary.append(" *")
        } else if currentSignalMetadata != nil {
            summary.append(" • synced")
        }
        return summary
    }

    func refreshSignals(accessToken: String) async {
        if isLoadingSignals { return }
        isLoadingSignals = true
        defer { isLoadingSignals = false }
        do {
            let files = try await FileService.shared.listFiles(
                withExtension: ".raw",
                includeContent: false,
                accessToken: accessToken
            )
            let metadata = files.map { $0.metadata }
            signals = buildSignalItems(from: metadata)
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
        }
    }

    func clearSignals() {
        signals = []
    }

    func loadSignal(id: String, accessToken: String) async -> Data? {
        do {
            let file = try await FileService.shared.getFile(id: id, accessToken: accessToken)
            guard let data = file.binaryContent, !data.isEmpty else {
                notice = Notice(title: "Error", message: "Signal file is empty")
                return nil
            }
            markBufferClean(with: file.metadata)
            return data
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
            return nil
        }
    }

    func saveSignal(buffer: Data, accessToken: String) async {
        guard !buffer.isEmpty else {
            notice = Notice(title: "Error", message: "Buffer is empty")
            return
        }

        isSavingSignal = true
        defer { isSavingSignal = false }

        do {
            let metadata: UserFileMetadata
            if let current = currentSignalMetadata {
                guard let etag = current.etag, !etag.isEmpty else {
                    throw FileServiceError.server(message: "Reload signal before saving changes")
                }
                metadata = try await FileService.shared.updateBinaryFile(
                    id: current.id,
                    etag: etag,
                    data: buffer,
                    accessToken: accessToken
                )
            } else {
                let normalized = normalizeSignalName(currentSignalName)
                metadata = try await FileService.shared.createBinaryFile(
                    name: normalized,
                    data: buffer,
                    accessToken: accessToken
                )
            }
            markBufferClean(with: metadata)
            let files = try await FileService.shared.listFiles(
                withExtension: ".raw",
                includeContent: false,
                accessToken: accessToken
            )
            signals = buildSignalItems(from: files.map { $0.metadata })
            notice = Notice(title: "Success", message: "Signal saved to cloud")
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
        }
    }

    func renameCurrentSignal(to newName: String, accessToken: String) async {
        guard let metadata = currentSignalMetadata else {
            notice = Notice(title: "Error", message: "Save the signal before renaming")
            return
        }
        guard !hasUnsavedChanges else {
            notice = Notice(title: "Error", message: "Save changes before renaming")
            return
        }

        let trimmed = normalizeSignalName(newName)
        guard trimmed.caseInsensitiveCompare(metadata.name) != .orderedSame else {
            return
        }

        isSavingSignal = true
        defer { isSavingSignal = false }

        do {
            let updated = try await FileService.shared.renameFile(
                id: metadata.id,
                name: trimmed,
                accessToken: accessToken
            )
            markBufferClean(with: updated)
            let files = try await FileService.shared.listFiles(
                withExtension: ".raw",
                includeContent: false,
                accessToken: accessToken
            )
            signals = buildSignalItems(from: files.map { $0.metadata })
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
        }
    }

    func deleteCurrentSignal(accessToken: String) async {
        guard let metadata = currentSignalMetadata else {
            notice = Notice(title: "Error", message: "Nothing to delete")
            return
        }
        guard !hasUnsavedChanges else {
            notice = Notice(title: "Error", message: "Save or discard changes before deleting")
            return
        }
        guard let etag = metadata.etag, !etag.isEmpty else {
            notice = Notice(title: "Error", message: "Reload signal before deleting")
            return
        }

        isSavingSignal = true
        defer { isSavingSignal = false }

        do {
            try await FileService.shared.deleteFile(
                id: metadata.id,
                etag: etag,
                accessToken: accessToken
            )
            currentSignalMetadata = nil
            currentSignalName = Self.defaultSignalName
            hasUnsavedChanges = false
            let files = try await FileService.shared.listFiles(
                withExtension: ".raw",
                includeContent: false,
                accessToken: accessToken
            )
            signals = buildSignalItems(from: files.map { $0.metadata })
            notice = Notice(title: "Success", message: "Signal deleted")
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
        }
    }

    // MARK: - Infrared Helpers

    func buildSignedRawTimings(from buffer: Data) -> String {
        guard !buffer.isEmpty else { return "" }

        var components: [String] = []
        let totalBits = buffer.count * 8
        var currentState = ((buffer[0] >> 0) & 1) == 1
        var count = 0

        for index in 0..<totalBits {
            let byteIndex = index / 8
            let bitIndex = index % 8
            let bit = ((buffer[byteIndex] >> bitIndex) & 1) == 1
            if bit == currentState {
                count += 1
            } else {
                appendTiming(state: currentState, count: count, into: &components)
                currentState = bit
                count = 1
            }
        }

        appendTiming(state: currentState, count: count, into: &components)
        return components.joined(separator: " ")
    }

    func decode(buffer: Data, accessToken: String) async {
        guard !buffer.isEmpty else {
            notice = Notice(title: "Error", message: "Buffer is empty")
            return
        }

        let timings = buildSignedRawTimings(from: buffer)
        guard !timings.isEmpty else {
            notice = Notice(title: "Error", message: "Unable to compute timings")
            return
        }

        outputText = "Decoding IRP..."
        isDecoding = true
        defer { isDecoding = false }

        do {
            let results = try await InfraredService.shared.decodeSignedRaw(
                timings: timings,
                strict: false,
                accessToken: accessToken
            )
            outputText = formatDecodeResults(results)
            if outputText.isEmpty {
                notice = Notice(title: "Info", message: "No decode results")
            }
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
        }
    }

    func renderSignal(
        protocolName: String,
        parameters: [String: Int],
        accessToken: String
    ) async -> Data? {
        guard !protocolName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            notice = Notice(title: "Error", message: "Protocol is required")
            return nil
        }

        outputText = "Rendering IRP..."
        isRendering = true
        defer { isRendering = false }

        do {
            let renderResult = try await InfraredService.shared.renderSignedRaw(
                protocolName: protocolName.trimmingCharacters(in: .whitespacesAndNewlines),
                parameters: parameters.reduce(into: [String: Any]()) { dict, entry in
                    dict[entry.key] = entry.value
                },
                accessToken: accessToken
            )
            outputText = renderResult.signedRaw
            let timings = parseSignedRawTimings(renderResult.signedRaw)
            guard !timings.isEmpty else {
                notice = Notice(title: "Error", message: "Rendered timings are empty")
                return nil
            }
            let utils = Utils()
            return utils.convertTimingsToBinary(timings)
        } catch {
            notice = Notice(title: "Error", message: error.localizedDescription)
            return nil
        }
    }

    func parseSignedRawTimings(_ text: String) -> [Double] {
        var normalized = text.replacingOccurrences(of: "[", with: " ")
            .replacingOccurrences(of: "]", with: " ")
            .replacingOccurrences(of: ",", with: " ")

        normalized = normalized.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        guard !normalized.isEmpty else { return [] }

        let separators = CharacterSet.whitespacesAndNewlines
        let components = normalized.components(separatedBy: separators).filter { !$0.isEmpty }

        return components.compactMap { token -> Double? in
            guard let value = Double(token), value != 0 else { return nil }
            return abs(value)
        }
    }

    // MARK: - Private

    private func refreshSignalListBindings() {
        signals = buildSignalItems(from: signals.map { $0.metadata })
    }

    private func buildSignalItems(from metadata: [UserFileMetadata]) -> [SignalListItem] {
        metadata
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .map { item in
                SignalListItem(
                    metadata: item,
                    isActive: item.id == currentSignalMetadata?.id,
                    isDirty: item.id == currentSignalMetadata?.id && hasUnsavedChanges
                )
            }
    }

    private func appendTiming(state: Bool, count: Int, into components: inout [String]) {
        guard count > 0 else { return }
        let microseconds = count * 10
        let prefix = state ? "" : "-"
        components.append("\(prefix)\(microseconds)")
    }

    private func formatDecodeResults(_ results: [InfraredDecodeResult]) -> String {
        guard !results.isEmpty else { return "" }
        return results.map { result in
            var lines: [String] = []
            if !result.protocolName.isEmpty {
                var line = result.protocolName
                if !result.parameters.isEmpty {
                    let formatted = result.parameters
                        .map { ($0.key, $0.value) }
                        .sorted { $0.0.localizedCaseInsensitiveCompare($1.0) == .orderedAscending }
                        .map { "\($0.0)=\($0.1)" }
                        .joined(separator: ", ")
                    line.append(" {\(formatted)}")
                }
                lines.append(line)
            }
            if !result.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                lines.append(result.raw.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            return lines.joined(separator: "\n")
        }
        .joined(separator: "\n\n")
    }
}