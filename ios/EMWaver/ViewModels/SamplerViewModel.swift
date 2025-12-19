import SwiftUI
import Foundation
import DGCharts

@MainActor
final class SamplerViewModel: ObservableObject {
    struct Notice: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    @Published var visibleRangeStart: Double = 0
    @Published var visibleRangeEnd: Double = 10000
    @Published private(set) var signalNames: [String] = []
    @Published private(set) var currentSignalName: String?
    @Published private(set) var hasUnsavedChanges = false
    @Published var outputText: String = ""
    @Published var notice: Notice?

    private var bleManager: BLEManager?
    private let settingsManager = SettingsManager.shared
    private let fileManager = FileManager.default
    private let signalsDir: URL
    private let legacySignalsDir: URL?
    
    private static let signalsDirectoryName = "signals"
    private static let lastSelectedSignalKey = "sampler_last_selected_signal"

    init() {
        let appSupportPath = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        signalsDir = appSupportPath.appendingPathComponent(Self.signalsDirectoryName, isDirectory: true)
        let documentsPath = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        legacySignalsDir = documentsPath.appendingPathComponent(Self.signalsDirectoryName, isDirectory: true)
        try? fileManager.createDirectory(at: signalsDir, withIntermediateDirectories: true)
        migrateLegacySignalsIfNeeded()
        refreshSignalList()
    }

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

    func refreshSignalList() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let files = try self.fileManager.contentsOfDirectory(at: self.signalsDir, includingPropertiesForKeys: [.nameKey])
                let names = files
                    .filter { $0.pathExtension.lowercased() == "raw" }
                    .map { $0.lastPathComponent }
                    .sorted()
                
                DispatchQueue.main.async {
                    self.signalNames = names
                }
            } catch {
                DispatchQueue.main.async {
                    self.notice = Notice(title: "Error", message: "Failed to list signals: \(error.localizedDescription)")
                }
            }
        }
    }

    func loadSignal(name: String) -> Data? {
        let signalFile = signalsDir.appendingPathComponent(name)
        guard fileManager.fileExists(atPath: signalFile.path) else {
            notice = Notice(title: "Error", message: "Signal file not found")
            return nil
        }
        
        guard let data = try? Data(contentsOf: signalFile), !data.isEmpty else {
            notice = Notice(title: "Error", message: "Signal file is empty")
            return nil
        }
        
        currentSignalName = name
        hasUnsavedChanges = false
        saveLastSelectedSignal(name)
        return data
    }

    func saveSignal(name: String, buffer: Data) {
        guard !buffer.isEmpty else {
            notice = Notice(title: "Error", message: "Buffer is empty")
            return
        }

        let normalized = normalizeSignalName(name)
        let signalFile = signalsDir.appendingPathComponent(normalized)
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                try buffer.write(to: signalFile)
                DispatchQueue.main.async {
                    self.currentSignalName = normalized
                    self.hasUnsavedChanges = false
                    self.saveLastSelectedSignal(normalized)
                    self.refreshSignalList()
                    self.notice = Notice(title: "Success", message: "Signal saved: \(normalized)")
                }
            } catch {
                DispatchQueue.main.async {
                    self.notice = Notice(title: "Error", message: "Failed to save signal: \(error.localizedDescription)")
                }
            }
        }
    }

    func renameSignal(from oldName: String, to newName: String) {
        let normalized = normalizeSignalName(newName)
        guard normalized.caseInsensitiveCompare(oldName) != .orderedSame else {
            return
        }
        
        let oldFile = signalsDir.appendingPathComponent(oldName)
        let newFile = signalsDir.appendingPathComponent(normalized)
        
        guard fileManager.fileExists(atPath: oldFile.path) else {
            notice = Notice(title: "Error", message: "Signal file not found")
            return
        }
        
        guard !fileManager.fileExists(atPath: newFile.path) else {
            notice = Notice(title: "Error", message: "A signal with this name already exists")
            return
        }
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                try self.fileManager.moveItem(at: oldFile, to: newFile)
                DispatchQueue.main.async {
                    if self.currentSignalName == oldName {
                        self.currentSignalName = normalized
                        self.saveLastSelectedSignal(normalized)
                    }
                    self.refreshSignalList()
                    self.notice = Notice(title: "Success", message: "Signal renamed")
                }
            } catch {
                DispatchQueue.main.async {
                    self.notice = Notice(title: "Error", message: "Failed to rename signal: \(error.localizedDescription)")
                }
            }
        }
    }

    func deleteSignal(name: String) {
        let signalFile = signalsDir.appendingPathComponent(name)
        guard fileManager.fileExists(atPath: signalFile.path) else {
            notice = Notice(title: "Error", message: "Signal file not found")
            return
        }
        
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                try self.fileManager.removeItem(at: signalFile)
                DispatchQueue.main.async {
                    if self.currentSignalName == name {
                        self.currentSignalName = nil
                        self.saveLastSelectedSignal(nil)
                    }
                    self.refreshSignalList()
                    self.notice = Notice(title: "Success", message: "Signal deleted")
                }
            } catch {
                DispatchQueue.main.async {
                    self.notice = Notice(title: "Error", message: "Failed to delete signal: \(error.localizedDescription)")
                }
            }
        }
    }

    func createNewSignal() {
        currentSignalName = nil
        hasUnsavedChanges = false
        saveLastSelectedSignal(nil)
    }

    func markBufferDirty() {
        hasUnsavedChanges = true
    }

    func markBufferClean() {
        hasUnsavedChanges = false
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
        let existing = Set(signalNames.map { $0.lowercased() })
        var counter = 1
        var candidate = "signal\(counter).raw"
        while existing.contains(candidate.lowercased()) {
            counter += 1
            candidate = "signal\(counter).raw"
        }
        return candidate
    }

    func loadLastSelectedSignal() -> String? {
        return UserDefaults.standard.string(forKey: Self.lastSelectedSignalKey)
    }

    private func saveLastSelectedSignal(_ name: String?) {
        if let name {
            UserDefaults.standard.set(name, forKey: Self.lastSelectedSignalKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.lastSelectedSignalKey)
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

    private func appendTiming(state: Bool, count: Int, into components: inout [String]) {
        guard count > 0 else { return }
        let microseconds = count * 10
        let prefix = state ? "" : "-"
        components.append("\(prefix)\(microseconds)")
    }

    private func migrateLegacySignalsIfNeeded() {
        guard let legacyDir = legacySignalsDir else { return }
        guard fileManager.fileExists(atPath: legacyDir.path) else { return }
        guard let files = try? fileManager.contentsOfDirectory(at: legacyDir, includingPropertiesForKeys: nil) else { return }
        for file in files where file.pathExtension.lowercased() == "raw" {
            let destination = signalsDir.appendingPathComponent(file.lastPathComponent)
            if fileManager.fileExists(atPath: destination.path) {
                continue
            }
            try? fileManager.moveItem(at: file, to: destination)
        }
    }
}
