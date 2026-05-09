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
        let bootloader: URL
        let partitionTable: URL
        let otaData: URL
        let app: URL
    }

    private struct EspBootloaderIdentity {
        let port: String
        let chip: String
    }

    @Published var isPresented: Bool = false
    @Published var dfuConnected: Bool = false
    @Published var espBootloaderConnected: Bool = false
    @Published var espBootloaderPort: String? = nil
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
    private let espSerialQueue = DispatchQueue(label: "com.emwaver.macos.esp-serial")
    private var espSerialProbeInFlight: Bool = false
    private var espSerialPollingEnabled: Bool = false

    private var flashProcess: Process? = nil
    private var flashStdoutBuffer = Data()
    private var flashStderrBuffer = Data()
    private var flashOutputBuffer = Data()
    private var espFlashRetry: (port: String, chip: String, attemptsRemaining: Int)? = nil

    init() {
        startDfuPolling()
        refreshDfuPresence()
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
        espSerialPollingEnabled = false
        isPresented = false
    }

    func setEspSerialPollingEnabled(_ enabled: Bool) {
        espSerialPollingEnabled = enabled
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
            startEspSerialUpdate(device: device)
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

    func refreshDfuPresence(includeEspSerialProbe: Bool = false) {
        if isFlashing { return }
        if includeEspSerialProbe {
            if espSerialProbeInFlight { return }
            espSerialProbeInFlight = true
        }

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

            do {
                let port = try self.espSerialQueue.sync {
                    try self.detectEspBootloaderPort()
                }
                DispatchQueue.main.async {
                    self.espSerialProbeInFlight = false
                    self.espBootloaderConnected = (port != nil)
                    self.espBootloaderPort = port
                    if port != nil {
                        self.presentedBoardType = "esp32"
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.espSerialProbeInFlight = false
                    self.espBootloaderConnected = false
                    self.espBootloaderPort = nil
                }
            }
        }
    }

    // MARK: - Private

    private func startDfuPolling() {
        if dfuPollTimer != nil { return }
        dfuPollTimer = Timer.scheduledTimer(withTimeInterval: 0.9, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                let includeEspSerialProbe = self.isPresented && (self.espSerialPollingEnabled || Self.isEspBoardType(self.presentedBoardType))
                self.refreshDfuPresence(includeEspSerialProbe: includeEspSerialProbe)
            }
        }
    }

    static func isEspBoardType(_ boardType: String?) -> Bool {
        switch (boardType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "esp32", "esp32s2", "esp32-s2", "esp32s3", "esp32-s3":
            return true
        default:
            return false
        }
    }

    static func normalizedEspBoardType(_ boardType: String?) -> String? {
        switch (boardType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
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
        if espBootloaderConnected || espBootloaderPort != nil {
            return "esp32"
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

    private func espFirmwareURLs(for chip: String) throws -> EspFirmwareAssets {
        let normalizedChip = try normalizedEspFlashChip(chip)

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

        return EspFirmwareAssets(
            chip: normalizedChip,
            bootloader: try require("emwaver-\(normalizedChip)-bootloader"),
            partitionTable: try require("emwaver-\(normalizedChip)-partition-table"),
            otaData: try require("emwaver-\(normalizedChip)-ota-data"),
            app: try require("emwaver-\(normalizedChip)-app")
        )
    }

    private func normalizedEspFlashChip(_ value: String?) throws -> String {
        switch (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "esp32s2", "esp32-s2":
            return "esp32s2"
        case "esp32s3", "esp32-s3":
            return "esp32s3"
        default:
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: 19,
                userInfo: [NSLocalizedDescriptionKey: "Could not identify the ESP chip target. Reconnect the board in bootloader mode, then retry."]
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
        let preferred = ports.filter { $0.contains("usbmodem") || $0.contains("usbserial") || $0.contains("SLAB_USBtoUART") }
        return preferred.isEmpty ? ports : preferred
    }

    private func detectEspBootloaderPort() throws -> String? {
        try detectEspBootloaderIdentity()?.port
    }

    private func resolveEspBootloaderIdentity() throws -> EspBootloaderIdentity {
        if let identity = try detectEspBootloaderIdentity() {
            return identity
        }

        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 18,
            userInfo: [NSLocalizedDescriptionKey: "Could not identify an ESP bootloader serial port. Put the board in bootloader mode, then retry."]
        )
    }

    private func detectEspBootloaderIdentity() throws -> EspBootloaderIdentity? {
        let ports = try espFlashPortCandidates()
        let candidates = preferredEspFlashPorts(from: ports)

        for port in candidates {
            do {
                return try readEspBootloaderIdentity(port: port)
            } catch {
                continue
            }
        }

        return nil
    }

    private func readEspBootloaderIdentity(port: String) throws -> EspBootloaderIdentity {
        let (code, stdout, stderr) = try runEspHelperAndWait(arguments: ["read-identity", "--port", port, "--baud", "115200"])
        if code != 0 {
            let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: Int(code),
                userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "Could not read ESP chip identity." : msg]
            )
        }

        return EspBootloaderIdentity(port: port, chip: try chipFromEspIdentity(stdout: stdout))
    }

    private func chipFromEspIdentity(stdout: String) throws -> String {
        for line in stdout.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2, parts[0] == "CHIP_NAME" else { continue }
            return try normalizedEspFlashChip(parts[1])
        }
        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 20,
            userInfo: [NSLocalizedDescriptionKey: "ESP chip identity did not include a supported chip name."]
        )
    }

    private func startEspSerialUpdate(device: MacUSBManager) {
        progressMessage = "Preparing ESP serial update..."
        completionMessage = "ESP firmware update complete. Reconnect the device in Run Mode."
        appendLog("ESP32 update selected")
        appendLog("ESP flashing uses the serial helper, not DFU.")
        if device.isConnected {
            appendLog("Run Mode remains separate from flashing; using serial port discovery.")
        }

        isFlashing = true
        progressPct = 0

        espSerialQueue.async { [weak self] in
            guard let self else { return }
            do {
                let identity = try self.resolveEspBootloaderIdentity()
                DispatchQueue.main.async {
                    self.appendLog("ESP flash port: \(identity.port)")
                    self.appendLog("ESP chip target: \(identity.chip)")
                    do {
                        try self.runEspFlash(port: identity.port, chip: identity.chip, attemptsRemaining: 2)
                    } catch {
                        self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                        self.progressMessage = ""
                        self.isFlashing = false
                        self.appendLog(self.updateError ?? "ESP update failed")
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.progressMessage = ""
                    self.isFlashing = false
                    self.appendLog(self.updateError ?? "ESP update failed")
                }
            }
        }
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

    private func runEspFlash(port: String, chip: String, attemptsRemaining: Int = 0) throws {
        if flashProcess != nil {
            return
        }

        let assets = try espFirmwareURLs(for: chip)
        appendLog("ESP bootloader: \(assets.bootloader.lastPathComponent)")
        appendLog("ESP partition table: \(assets.partitionTable.lastPathComponent)")
        appendLog("ESP OTA data: \(assets.otaData.lastPathComponent)")
        appendLog("ESP app image: \(assets.app.lastPathComponent)")

        isFlashing = true
        progressMessage = "Flashing ESP firmware..."
        progressPct = 0

        let process = Process()
        process.executableURL = try espHelperURL()
        process.arguments = [
            "flash",
            "--chip", assets.chip,
            "--port", port,
            "--baud", "115200",
            "--before", "no_reset",
            "--after", "hard_reset",
            "--no-stub",
            "--bootloader", assets.bootloader.path,
            "--partition-table", assets.partitionTable.path,
            "--ota-data", assets.otaData.path,
            "--app", assets.app.path,
        ]

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        flashStdoutBuffer = Data()
        flashStderrBuffer = Data()
        flashOutputBuffer = Data()
        flashProcess = process
        espFlashRetry = (port: port, chip: chip, attemptsRemaining: attemptsRemaining)

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
                    self.espFlashRetry = nil
                    self.progressPct = 100
                    self.progressMessage = ""
                    self.updateDone = true
                    self.appendLog(self.completionMessage)
                } else {
                    let err = String(data: self.flashStderrBuffer, encoding: .utf8) ?? ""
                    let msg = err.trimmingCharacters(in: .whitespacesAndNewlines)
                    if self.shouldRetryEspFlashAfterBusy(message: msg),
                       let retry = self.espFlashRetry,
                       retry.attemptsRemaining > 0 {
                        self.appendLog("ESP serial port was busy; retrying flash...")
                        self.progressMessage = "Waiting for ESP serial port..."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.75) {
                            do {
                                try self.runEspFlash(port: retry.port, chip: retry.chip, attemptsRemaining: retry.attemptsRemaining - 1)
                            } catch {
                                self.espFlashRetry = nil
                                self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                                self.progressMessage = ""
                                self.appendLog(self.updateError ?? "ESP firmware update failed")
                            }
                        }
                        return
                    }
                    self.espFlashRetry = nil
                    self.updateError = msg.isEmpty ? "ESP firmware update failed (exit code: \(proc.terminationStatus))." : msg
                    self.progressMessage = ""
                    self.appendLog(self.updateError ?? "ESP firmware update failed")
                }
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            do {
                try process.run()
            } catch {
                self.flashProcess = nil
                self.isFlashing = false
                self.espFlashRetry = nil
                self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                self.progressMessage = ""
                self.appendLog(self.updateError ?? "ESP firmware update failed")
            }
        }
    }

    private func shouldRetryEspFlashAfterBusy(message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("resource busy") || lower.contains("port is busy")
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
