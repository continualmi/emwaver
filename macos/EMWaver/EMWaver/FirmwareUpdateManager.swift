import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

final class FirmwareUpdateManager: ObservableObject {
    private struct EspFirmwareAssets {
        let chip: String
        let bootloaderOffset: String
        let partitionTableOffset: String
        let otaDataOffset: String?
        let appOffset: String
        let flashFrequency: String
        let flashSize: String
        let bootloader: URL
        let partitionTable: URL
        let otaData: URL?
        let app: URL
    }

    private struct EspSerialTarget {
        let port: String
        let boardType: String?
    }

    @Published var isPresented: Bool = false
    @Published var dfuConnected: Bool = false
    @Published var espBootloaderConnected: Bool = false
    @Published var espBootloaderPort: String? = nil
    @Published var espBootloaderBoardType: String? = nil
    @Published var presentedBoardType: String? = nil
    @Published var isFlashing: Bool = false
    @Published var progressPct: Double = 0
    @Published var progressMessage: String = ""
    @Published var updateError: String? = nil
    @Published var updateDone: Bool = false
    @Published var completionMessage: String = "Update complete. Reconnect the device to use it."
    @Published var logLines: [String] = []
    @Published var firmwareSourceUsesCustom: Bool = false
    @Published var customFirmwarePath: String? = nil

    private var dfuPollTimer: Timer? = nil

    private var flashProcess: Process? = nil
    private var flashStdoutBuffer = Data()
    private var flashStderrBuffer = Data()
    private var flashOutputBuffer = Data()

    init() {
        startDfuPolling()
        refreshDfuPresence(includeEspSerialProbe: true)
    }

    deinit {
        dfuPollTimer?.invalidate()
        dfuPollTimer = nil
    }

    func present(boardType: String? = nil) {
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = ""
        completionMessage = "Update complete. Reconnect the device to use it."
        presentedBoardType = boardType
        isPresented = true
    }

    func dismiss() {
        isPresented = false
    }

    func startUpdate(device: MacUSBManager) {
        appendLog("Update requested")
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Preparing update..."
        completionMessage = "Update complete. Reconnect the device to use it."
        presentedBoardType = effectiveBoardType(for: device)

        if isFlashing {
            return
        }

        let boardType = effectiveBoardType(for: device)
        if Self.isEspBoardType(boardType) || espBootloaderConnected || espBootloaderPort != nil {
            do {
                try startEspSerialUpdate(device: device)
            } catch {
                updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                progressMessage = ""
                appendLog(updateError ?? "ESP update failed")
            }
            return
        }

        // If DFU is already present, just flash the managed firmware.
        let dfuAvailableNow = dfuConnected || detectDfuConnectedNow()
        if dfuAvailableNow {
            dfuConnected = true
            appendLog("Update Mode confirmed; starting flash")
            do {
                try runFlash()
            } catch {
                updateError = String(describing: error)
                dfuConnected = detectDfuConnectedNow()
                appendLog(updateError ?? "Update failed")
                isFlashing = false
            }
            return
        }

        // Otherwise, ask the connected device to enter DFU.
        if device.isConnected {
            progressMessage = "Switching device to Update Mode..."
            appendLog("Requesting Update Mode from Run Mode")
            device.requestEnterUpdateMode()
            device.disconnect()
        } else {
            dfuConnected = false
            progressMessage = ""
            updateError = "Update Mode is not detected. Reconnect the device in Update Mode, then try again."
            appendLog(updateError ?? "Update failed")
            return
        }

        // Poll for DFU presence with a short timeout.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }

            let deadline = Date().addingTimeInterval(8.0)
            var lastErr: String? = nil
            var detected = false

            while Date() < deadline {
                do {
                    let (code, _, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
                    if code == 0 {
                        detected = true
                        break
                    }
                    if code != 1 {
                        let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !msg.isEmpty { lastErr = msg }
                    }
                } catch {
                    lastErr = String(describing: error)
                }

                Thread.sleep(forTimeInterval: 0.25)
            }

            DispatchQueue.main.async {
                self.dfuConnected = detected

                if !detected {
                    self.progressMessage = ""
                    self.updateError = lastErr ?? "Failed to enter Update Mode (DFU not detected)."
                    self.appendLog(self.updateError ?? "DFU not detected")
                    return
                }

                self.progressMessage = "Preparing update..."
                do {
                    try self.runFlash()
                } catch {
                    self.updateError = String(describing: error)
                    self.appendLog(self.updateError ?? "Update failed")
                    self.isFlashing = false
                }
            }
        }
    }

    func clearLogs() {
        logLines.removeAll(keepingCapacity: false)
    }

    func toggleFirmwareSource() {
        if firmwareSourceUsesCustom {
            firmwareSourceUsesCustom = false
            customFirmwarePath = nil
            appendLog("Using bundled firmware")
        } else {
            firmwareSourceUsesCustom = true
            appendLog("Custom firmware mode enabled")
        }
    }

    func selectCustomFirmware() {
#if canImport(AppKit)
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.data]
        panel.prompt = "Select Firmware"
        panel.message = "Choose a .bin firmware image."
        if panel.runModal() == .OK, let url = panel.url {
            firmwareSourceUsesCustom = true
            customFirmwarePath = url.path
            appendLog("Custom firmware selected: \(url.lastPathComponent)")
        }
#endif
    }

    var firmwareSummary: String {
        if firmwareSourceUsesCustom, let path = customFirmwarePath, !path.isEmpty {
            return URL(fileURLWithPath: path).lastPathComponent
        }
        return "Bundled emwaver.bin"
    }

    func refreshDfuPresence(includeEspSerialProbe: Bool = true) {
        if isFlashing { return }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            do {
                let (code, _, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
                DispatchQueue.main.async {
                    switch code {
                    case 0:
                        self.dfuConnected = true
                    case 1:
                        self.dfuConnected = false
                    default:
                        self.dfuConnected = false
                        let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !msg.isEmpty {
                            self.updateError = msg
                        }
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.dfuConnected = false
                    self.updateError = String(describing: error)
                }
            }

            guard includeEspSerialProbe else { return }

            let target = self.detectEspSerialCandidate()
            DispatchQueue.main.async {
                self.espBootloaderConnected = (target != nil)
                self.espBootloaderPort = target?.port
                self.espBootloaderBoardType = target?.boardType
                if let boardType = target?.boardType {
                    self.presentedBoardType = boardType
                }
            }
        }
    }

    // MARK: - Private

    private func startDfuPolling() {
        if dfuPollTimer != nil { return }
        dfuPollTimer = Timer.scheduledTimer(withTimeInterval: 0.9, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                self?.refreshDfuPresence(includeEspSerialProbe: true)
            }
        }
    }

    static func isEspBoardType(_ boardType: String?) -> Bool {
        switch (boardType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "esp", "esp8266", "esp32", "esp32s2", "esp32-s2", "esp32s3", "esp32-s3":
            return true
        default:
            return false
        }
    }

    static func normalizedEspBoardType(_ boardType: String?) -> String? {
        switch (boardType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "esp8266", "esp8266ex":
            return "esp8266"
        case "esp32s2", "esp32-s2":
            return "esp32s2"
        case "esp32s3", "esp32-s3":
            return "esp32s3"
        case "esp32":
            return "esp32"
        default:
            return nil
        }
    }

    private func effectiveBoardType(for device: MacUSBManager) -> String {
        if let boardType = Self.normalizedEspBoardType(presentedBoardType) {
            return boardType
        }
        if let boardType = Self.normalizedEspBoardType(espBootloaderBoardType) {
            return boardType
        }
        if espBootloaderConnected || espBootloaderPort != nil {
            return "esp"
        }
        return device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private func helperURL(name: String) throws -> URL {
        if let url = Bundle.main.url(forResource: name, withExtension: nil) {
            return url
        }
        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Missing bundled helper (\(name))."]
        )
    }

    private func helperURL() throws -> URL {
        try helperURL(name: "emwaver-dfu-helper")
    }

    private func espHelperURL() throws -> URL {
        #if DEBUG
        if let repoRoot = debugRepoRoot() {
            let repoDistHelper = repoRoot
                .appendingPathComponent("tools/emwaver-esp-helper/dist/emwaver-esp-helper/emwaver-esp-helper", isDirectory: false)
            if FileManager.default.isExecutableFile(atPath: repoDistHelper.path) {
                return repoDistHelper
            }
        }
        #endif

        if let bundled = Bundle.main.resourceURL?
            .appendingPathComponent("emwaver-esp-helper", isDirectory: true)
            .appendingPathComponent("emwaver-esp-helper", isDirectory: false),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        return try helperURL(name: "emwaver-esp-helper")
    }

    private func debugRepoRoot() -> URL? {
        let fm = FileManager.default
        let startPoints: [URL] = [
            URL(fileURLWithPath: fm.currentDirectoryPath, isDirectory: true).standardizedFileURL,
            URL(fileURLWithPath: #filePath, isDirectory: false).deletingLastPathComponent(),
            Bundle.main.bundleURL.deletingLastPathComponent()
        ]

        for start in startPoints {
            var candidate = start
            for _ in 0..<10 {
                let helper = candidate.appendingPathComponent("tools/emwaver-esp-helper/dist/emwaver-esp-helper/emwaver-esp-helper", isDirectory: false)
                if fm.isExecutableFile(atPath: helper.path) {
                    return candidate
                }

                let parent = candidate.deletingLastPathComponent()
                if parent.path == candidate.path { break }
                candidate = parent
            }
        }

        return nil
    }

    private func espFirmwareURLs(boardType: String) throws -> EspFirmwareAssets {
        func require(_ name: String) throws -> URL {
            if let url = Bundle.main.url(forResource: name, withExtension: "bin") {
                return url
            }
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: 17,
                userInfo: [NSLocalizedDescriptionKey: "Missing bundled ESP firmware asset (\(name).bin)."]
            )
        }

        switch Self.normalizedEspBoardType(boardType) {
        case "esp8266":
            return EspFirmwareAssets(
                chip: "esp8266",
                bootloaderOffset: "0x0",
                partitionTableOffset: "0x8000",
                otaDataOffset: nil,
                appOffset: "0x10000",
                flashFrequency: "40m",
                flashSize: "2MB",
                bootloader: try require("emwaver-esp8266-bootloader"),
                partitionTable: try require("emwaver-esp8266-partition-table"),
                otaData: nil,
                app: try require("emwaver-esp8266-app")
            )
        case "esp32":
            return EspFirmwareAssets(
                chip: "esp32",
                bootloaderOffset: "0x1000",
                partitionTableOffset: "0x8000",
                otaDataOffset: "0x10000",
                appOffset: "0x20000",
                flashFrequency: "40m",
                flashSize: "4MB",
                bootloader: try require("emwaver-esp32-bootloader"),
                partitionTable: try require("emwaver-esp32-partition-table"),
                otaData: try require("emwaver-esp32-ota-data"),
                app: try require("emwaver-esp32-app")
            )
        case "esp32s2":
            return EspFirmwareAssets(
                chip: "esp32s2",
                bootloaderOffset: "0x1000",
                partitionTableOffset: "0x8000",
                otaDataOffset: "0x10000",
                appOffset: "0x20000",
                flashFrequency: "80m",
                flashSize: "4MB",
                bootloader: try require("emwaver-esp32s2-bootloader"),
                partitionTable: try require("emwaver-esp32s2-partition-table"),
                otaData: try require("emwaver-esp32s2-ota-data"),
                app: try require("emwaver-esp32s2-app")
            )
        case "esp32s3":
            return EspFirmwareAssets(
                chip: "esp32s3",
                bootloaderOffset: "0x0",
                partitionTableOffset: "0x8000",
                otaDataOffset: "0x10000",
                appOffset: "0x20000",
                flashFrequency: "80m",
                flashSize: "4MB",
                bootloader: try require("emwaver-esp32s3-bootloader"),
                partitionTable: try require("emwaver-esp32s3-partition-table"),
                otaData: try require("emwaver-esp32s3-ota-data"),
                app: try require("emwaver-esp32s3-app")
            )
        default:
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: 20,
                userInfo: [NSLocalizedDescriptionKey: "Unknown ESP board type for firmware flashing."]
            )
        }
    }

    private func espFlashPortCandidates() throws -> [String] {
        let (code, stdout, stderr) = try runEspHelperAndWait(arguments: ["list-ports"])
        if code != 0 {
            let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: Int(code),
                userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "Failed to list ESP serial ports." : msg]
            )
        }

        let ports = stdout.split(separator: "\n").compactMap { line -> String? in
            guard let field = line.split(separator: "\t").first,
                  field.starts(with: "PORT=") else { return nil }
            let port = String(field.dropFirst(5)).trimmingCharacters(in: .whitespacesAndNewlines)
            return port.isEmpty ? nil : port
        }
        return ports
    }

    private func preferredEspFlashPorts(from ports: [String]) -> [String] {
        ports.filter { port in
            let lowercased = port.lowercased()
            return lowercased.contains("usbmodem") ||
                lowercased.contains("usbserial") ||
                lowercased.contains("slab_usbtouart") ||
                lowercased.contains("wchusbserial")
        }
    }

    private func espSerialDeviceNodeCandidates() -> [String] {
        let devURL = URL(fileURLWithPath: "/dev", isDirectory: true)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: devURL.path) else {
            return []
        }
        return names
            .filter { $0.hasPrefix("cu.") }
            .map { devURL.appendingPathComponent($0).path }
            .sorted()
    }

    private func detectEspSerialCandidate() -> EspSerialTarget? {
        let ports = espSerialDeviceNodeCandidates()
        let preferred = preferredEspFlashPorts(from: ports)
        guard let port = preferred.first else { return nil }
        return EspSerialTarget(port: port, boardType: Self.normalizedEspBoardType(espBootloaderBoardType))
    }

    private func resolveEspFlashPort() throws -> String {
        if let detected = try detectEspBootloaderTarget() {
            espBootloaderBoardType = detected.boardType
            return detected.port
        }

        let ports = try espFlashPortCandidates()
        let preferred = preferredEspFlashPorts(from: ports)
        if preferred.count == 1, let port = preferred.first {
            return port
        }
        if ports.count == 1, let port = ports.first {
            return port
        }
        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 18,
            userInfo: [NSLocalizedDescriptionKey: "Could not choose a unique ESP serial port. Connect only the ESP flash port, then retry."]
        )
    }

    private func detectEspBootloaderTarget() throws -> EspSerialTarget? {
        let ports = try espFlashPortCandidates()
        let preferred = preferredEspFlashPorts(from: ports)
        let candidates = preferred.isEmpty ? ports : preferred

        for port in candidates {
            if let boardType = try readEspBoardType(port: port) {
                return EspSerialTarget(port: port, boardType: boardType)
            }

            let (code, _, _) = try runEspHelperAndWait(arguments: ["chip-id", "--port", port, "--baud", "115200", "--no-stub"])
            if code == 0 {
                return EspSerialTarget(port: port, boardType: "esp32")
            }
        }

        return nil
    }

    private func readEspBoardType(port: String) throws -> String? {
        let (code, stdout, _) = try runEspHelperAndWait(arguments: ["read-identity", "--port", port, "--baud", "115200"])
        guard code == 0 else { return nil }
        for line in stdout.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0] == "CHIP_NAME" else { continue }
            let normalized = parts[1].trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "-", with: "")
            if normalized.hasPrefix("esp8266") {
                return "esp8266"
            }
            return Self.normalizedEspBoardType(normalized)
        }
        return nil
    }

    private func startEspSerialUpdate(device: MacUSBManager) throws {
        progressMessage = "Preparing ESP serial update..."
        completionMessage = "ESP firmware update complete. Reconnect the device in Run Mode."
        appendLog("ESP update selected")
        appendLog("ESP flashing uses the serial helper, not DFU.")
        if device.isConnected {
            appendLog("Run Mode remains separate from flashing; using serial port discovery.")
        }

        let port = try resolveEspFlashPort()
        let boardType = effectiveBoardType(for: device)
        appendLog("ESP board type: \(boardType)")
        appendLog("ESP flash port: \(port)")
        try runEspFlash(port: port, boardType: boardType)
    }

    private func runEspHelperAndWait(arguments: [String]) throws -> (terminationStatus: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = try espHelperURL()
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
        let stdoutStr = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrStr = String(data: stderrData, encoding: .utf8) ?? ""
        return (process.terminationStatus, stdoutStr, stderrStr)
    }

    private func runEspFlash(port: String, boardType: String) throws {
        if flashProcess != nil {
            return
        }

        let assets = try espFirmwareURLs(boardType: boardType)
        appendLog("ESP chip: \(assets.chip)")
        appendLog("ESP bootloader: \(assets.bootloader.lastPathComponent)")
        appendLog("ESP partition table: \(assets.partitionTable.lastPathComponent)")
        if let otaData = assets.otaData {
            appendLog("ESP OTA data: \(otaData.lastPathComponent)")
        }
        appendLog("ESP app image: \(assets.app.lastPathComponent)")

        isFlashing = true
        progressMessage = "Flashing ESP firmware..."
        progressPct = 0

        let process = Process()
        process.executableURL = try espHelperURL()
        var arguments = [
            "flash",
            "--chip", assets.chip,
            "--port", port,
            "--baud", "460800",
            "--before", "default_reset",
            "--after", "hard_reset",
            "--bootloader-offset", assets.bootloaderOffset,
            "--partition-table-offset", assets.partitionTableOffset,
            "--app-offset", assets.appOffset,
            "--flash-freq", assets.flashFrequency,
            "--flash-size", assets.flashSize,
            "--bootloader", assets.bootloader.path,
            "--partition-table", assets.partitionTable.path,
            "--app", assets.app.path,
        ]
        if let otaData = assets.otaData, let otaDataOffset = assets.otaDataOffset {
            arguments.append(contentsOf: ["--ota-data-offset", otaDataOffset, "--ota-data", otaData.path])
        }
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        flashStdoutBuffer = Data()
        flashStderrBuffer = Data()
        flashOutputBuffer = Data()
        flashProcess = process

        stdout.fileHandleForReading.readabilityHandler = { [weak self] fh in
            guard let self else { return }
            let data = fh.availableData
            if data.isEmpty { return }
            DispatchQueue.main.async {
                self.ingestFlashStdout(data)
            }
        }

        stderr.fileHandleForReading.readabilityHandler = { [weak self] fh in
            guard let self else { return }
            let data = fh.availableData
            if data.isEmpty { return }
            DispatchQueue.main.async {
                self.flashStderrBuffer.append(data)
                self.ingestFlashOutput(data)
            }
        }

        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self else { return }
                stdout.fileHandleForReading.readabilityHandler = nil
                stderr.fileHandleForReading.readabilityHandler = nil

                self.flashProcess = nil
                self.isFlashing = false

                if proc.terminationStatus == 0 {
                    self.progressPct = 100
                    self.progressMessage = ""
                    self.updateDone = true
                    self.espBootloaderConnected = false
                    self.espBootloaderPort = nil
                    self.espBootloaderBoardType = nil
                    self.appendLog(self.completionMessage)
                } else {
                    let err = String(data: self.flashStderrBuffer, encoding: .utf8) ?? ""
                    let msg = err.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.updateError = msg.isEmpty ? "ESP firmware update failed (exit code: \(proc.terminationStatus))." : msg
                    self.progressMessage = ""
                    self.appendLog(self.updateError ?? "ESP firmware update failed")
                }
            }
        }

        try process.run()
    }

    private func firmwareURL() throws -> URL {
        if firmwareSourceUsesCustom {
            guard let path = customFirmwarePath, !path.isEmpty else {
                throw NSError(
                    domain: "FirmwareUpdateManager",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Custom firmware is selected, but no .bin file was chosen."]
                )
            }
            return URL(fileURLWithPath: path)
        }
        if let url = Bundle.main.url(forResource: "emwaver", withExtension: "bin") {
            return url
        }
        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Missing bundled firmware (emwaver.bin)."]
        )
    }

    private func runHelperAndWait(arguments: [String]) throws -> (terminationStatus: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = try helperURL()
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
        let stdoutStr = String(data: stdoutData, encoding: .utf8) ?? ""
        let stderrStr = String(data: stderrData, encoding: .utf8) ?? ""
        return (process.terminationStatus, stdoutStr, stderrStr)
    }

    private func waitForDfuPresence(timeoutSeconds: TimeInterval = 8.0) async throws {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        var lastErr: String? = nil

        while Date() < deadline {
            let (code, _, stderr) = try runHelperAndWait(arguments: ["is-connected"])
            if code == 0 {
                await MainActor.run {
                    self.dfuConnected = true
                    self.appendLog("Update Mode detected")
                }
                return
            }
            if code != 1 {
                let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                if !msg.isEmpty {
                    lastErr = msg
                }
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }

        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 16,
            userInfo: [NSLocalizedDescriptionKey: lastErr ?? "DFU not detected"]
        )
    }

    private func detectDfuConnectedNow() -> Bool {
        do {
            let (code, _, _) = try runHelperAndWait(arguments: ["is-connected"])
            return code == 0
        } catch {
            return false
        }
    }

    private func runFlash() throws {
        if flashProcess != nil {
            return
        }

        isFlashing = true

        let fw = try firmwareURL()
        appendLog("Flashing firmware: \(fw.lastPathComponent)")

        let process = Process()
        process.executableURL = try helperURL()
        process.arguments = ["flash", "--firmware", fw.path]

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        flashStdoutBuffer = Data()
        flashStderrBuffer = Data()
        flashOutputBuffer = Data()
        flashProcess = process

        stdout.fileHandleForReading.readabilityHandler = { [weak self] fh in
            guard let self else { return }
            let data = fh.availableData
            if data.isEmpty { return }
            DispatchQueue.main.async {
                self.ingestFlashStdout(data)
            }
        }

        stderr.fileHandleForReading.readabilityHandler = { [weak self] fh in
            guard let self else { return }
            let data = fh.availableData
            if data.isEmpty { return }
            DispatchQueue.main.async {
                self.flashStderrBuffer.append(data)
                self.ingestFlashOutput(data)
            }
        }

        process.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard let self else { return }
                stdout.fileHandleForReading.readabilityHandler = nil
                stderr.fileHandleForReading.readabilityHandler = nil

                self.flashProcess = nil
                self.isFlashing = false

                let code = proc.terminationStatus
                if code == 0 {
                    self.progressPct = 100
                    self.updateDone = true
                    self.progressMessage = ""
                    self.appendLog(self.completionMessage)
                } else {
                    let err = String(data: self.flashStderrBuffer, encoding: .utf8) ?? ""
                    let msg = err.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.updateError = msg.isEmpty ? "Firmware update failed (exit code: \(code))." : msg
                    self.appendLog(self.updateError ?? "Firmware update failed")
                }
            }
        }

        try process.run()
    }

    private func ingestFlashStdout(_ data: Data) {
        flashStdoutBuffer.append(data)
        ingestFlashOutput(data)
    }

    private func ingestFlashOutput(_ data: Data) {
        let normalized = Data(data.map { $0 == 0x0D ? 0x0A : $0 })
        flashOutputBuffer.append(normalized)

        while true {
            guard let nlRange = flashOutputBuffer.range(of: Data([0x0A])) else { break }
            let lineData = flashOutputBuffer.subdata(in: 0..<nlRange.lowerBound)
            flashOutputBuffer.removeSubrange(0..<nlRange.upperBound)

            let line = (String(data: lineData, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            appendLog(line)
            handleProgressLine(line)
        }
    }

    private func handleProgressLine(_ line: String) {
        let cleaned = line
            .replacingOccurrences(of: #"\s*\(?\s*\d{1,3}\s*%\s*\)?\s*$"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if !cleaned.isEmpty {
            progressMessage = cleaned
        }

        if let match = line.range(of: #"\(?\s*(\d{1,3})\s*%\s*\)?"#, options: .regularExpression) {
            let token = String(line[match])
            let digits = token.filter(\.isNumber)
            if let pct = Int(digits) {
                progressPct = Double(max(0, min(100, pct)))
            }
            return
        }

        let lower = line.lowercased()
        if lower.contains("writing at") || lower.contains("writing flash") {
            progressMessage = "Writing firmware..."
        } else if lower.contains("hash of data verified") || lower.contains("hard resetting via") {
            progressPct = max(progressPct, 100)
        } else if lower.contains("erasing flash") {
            progressPct = max(progressPct, 2)
            progressMessage = "Erasing flash..."
        }
    }

    private func appendLog(_ line: String) {
        let ts = ISO8601DateFormatter().string(from: Date())
        logLines.append("\(ts)  \(line)")
        if logLines.count > 500 {
            logLines.removeFirst(logLines.count - 500)
        }
    }
}
