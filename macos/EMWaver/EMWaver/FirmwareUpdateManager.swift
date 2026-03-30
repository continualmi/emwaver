import Foundation
import Combine
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

final class FirmwareUpdateManager: ObservableObject {
    private struct EspSerialIdentity {
        let hardwareUidHex: String
        let macHex: String
        let chipRevision: Int
        let featuresHex: String
        let cores: Int
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

    private var flashProcess: Process? = nil
    private var flashStdoutBuffer = Data()
    private var flashStderrBuffer = Data()
    private var flashOutputBuffer = Data()

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
        if isEspBoardType(boardType) || espBootloaderConnected || espBootloaderPort != nil {
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

    func startMintAndProvision(auth: AuthenticationManager, accountDevices: AccountDevicesService, device: MacUSBManager) {
        appendLog("Activation requested")
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Reading hardware UID..."
        completionMessage = "Activation complete. Reconnect the device to use it."

        if isFlashing {
            return
        }

        guard !auth.accessToken.isEmpty else {
            updateError = "Enter your EMWaver key to activate this device."
            appendLog(updateError ?? "Activation failed")
            return
        }
        guard let baseURL = BackendUrl.resolve() else {
            updateError = "Missing backend URL (configure backend first)."
            appendLog(updateError ?? "Activation failed")
            return
        }
        if !device.isConnected && !dfuConnected {
            updateError = "Connect a device in Run mode or Update Mode to activate it."
            appendLog(updateError ?? "Activation failed")
            return
        }
        if !device.isConnected {
            updateError = "Activation currently requires a device connected in Run mode so macOS can read its hardware UID."
            appendLog(updateError ?? "Activation failed")
            return
        }
        let boardType = device.connectedBoardType ?? "stm32f042"
        if isEspBoardType(boardType) {
            updateError = "ESP activation is not wired through this STM32 flow. Use the ESP claim-and-flash path instead."
            appendLog(updateError ?? "Activation failed")
            return
        }

        // Step 1: claim or restore access for this physical board using its hardware UID.
        struct MintResponse: Decodable {
            let created: Bool?
        }

        Task {
            do {
                guard let hardwareUid = device.readHardwareUid(timeoutMs: 1200) else {
                    throw NSError(domain: "FirmwareUpdateManager", code: 1001, userInfo: [
                        NSLocalizedDescriptionKey: "Failed to read hardware UID from device."
                    ])
                }
                let hardwareUidHex = hardwareUid.map { String(format: "%02X", $0) }.joined()

                let url = baseURL.appendingPathComponent("provisioning/mint")
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("Bearer \(auth.accessToken)", forHTTPHeaderField: "Authorization")
                req.httpBody = try JSONSerialization.data(withJSONObject: [
                    "board_type": boardType,
                    "hardware_uid": hardwareUidHex,
                ])

                let (data, res) = try await URLSession.shared.data(for: req)
                let code = (res as? HTTPURLResponse)?.statusCode ?? -1
                if code < 200 || code >= 300 {
                    if code == 401 {
                        await MainActor.run {
                            auth.handleUnauthorizedResponse()
                        }
                    }
                    let msg = String(data: data, encoding: .utf8) ?? ""
                    throw NSError(domain: "FirmwareUpdateManager", code: code, userInfo: [NSLocalizedDescriptionKey: "Mint failed: \(msg)"])
                }
                let mint = try JSONDecoder().decode(MintResponse.self, from: data)
                await MainActor.run {
                    self.progressMessage = "Claiming device..."
                    accountDevices.storeClaimedDevice(
                        boardType: boardType,
                        hardwareUid: hardwareUidHex
                    )
                    self.appendLog((mint.created ?? false) ? "Backend device claim succeeded" : "Backend device restore succeeded")
                    self.appendLog("Board type: \(boardType)")
                    self.appendLog("Hardware UID: \(hardwareUidHex)")
                    self.appendLog("Stored claimed device locally for immediate access")
                }

                // Step 2: enter DFU and flash bundled firmware.
                await MainActor.run {
                    self.progressMessage = "Switching device to Update Mode..."
                }

                if !self.dfuConnected, device.isConnected {
                    await MainActor.run {
                        self.appendLog("Requesting Update Mode from Run Mode")
                    }
                    device.requestEnterUpdateMode()
                    device.disconnect()
                }

                if !self.dfuConnected {
                    try await self.waitForDfuPresence()
                }

                await MainActor.run {
                    self.progressMessage = "Flashing EMWaver firmware..."
                    self.appendLog("Flashing in Update Mode")
                }

                try await MainActor.run {
                    try self.runFlash()
                }
            } catch {
                await MainActor.run {
                    self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.progressMessage = ""
                    self.appendLog(self.updateError ?? "Activation failed")
                }
            }
        }
    }

    func startEspClaimAndFlash(auth: AuthenticationManager, accountDevices: AccountDevicesService, device: MacUSBManager) {
        appendLog("ESP setup requested")
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Claiming device..."
        completionMessage = "ESP setup complete. Reconnect the device in Run Mode."

        if isFlashing {
            return
        }

        guard !auth.accessToken.isEmpty else {
            updateError = "Enter your EMWaver key to set up this device."
            appendLog(updateError ?? "ESP setup failed")
            return
        }
        guard let baseURL = BackendUrl.resolve() else {
            updateError = "Missing backend URL (configure backend first)."
            appendLog(updateError ?? "ESP setup failed")
            return
        }

        let boardType = effectiveBoardType(for: device)
        guard isEspBoardType(boardType) || espBootloaderConnected || espBootloaderPort != nil else {
            updateError = "ESP setup requires an ESP32-S3 board."
            appendLog(updateError ?? "ESP setup failed")
            return
        }

        Task {
            do {
                let hardwareUidHex: String
                if let cachedHardwareUid = self.normalizedHardwareUid(device.hardwareUidHex ?? device.lastDetectedHardwareUidHex) {
                    hardwareUidHex = cachedHardwareUid
                    await MainActor.run {
                        self.appendLog("Using existing EMWaver runtime hardware UID")
                        self.appendLog("Hardware UID: \(cachedHardwareUid)")
                    }
                } else {
                    let identity = try self.readEspSerialIdentity()
                    hardwareUidHex = identity.hardwareUidHex
                    await MainActor.run {
                        device.lastDetectedHardwareUidHex = identity.hardwareUidHex
                        device.lastDetectedBoardType = "esp32s3"
                        self.appendLog("Read raw ESP identity from ROM bootloader")
                        self.appendLog("MAC: \(identity.macHex)")
                        self.appendLog("Chip revision: \(identity.chipRevision)")
                        self.appendLog("Features: \(identity.featuresHex)")
                        self.appendLog("Cores: \(identity.cores)")
                        self.appendLog("Hardware UID: \(identity.hardwareUidHex)")
                    }
                }

                struct MintResponse: Decodable {
                    let created: Bool?
                }

                var req = URLRequest(url: baseURL.appendingPathComponent("provisioning/mint"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue("Bearer \(auth.accessToken)", forHTTPHeaderField: "Authorization")
                req.httpBody = try JSONSerialization.data(withJSONObject: [
                    "board_type": "esp32s3",
                    "hardware_uid": hardwareUidHex,
                ])

                let (data, res) = try await URLSession.shared.data(for: req)
                let code = (res as? HTTPURLResponse)?.statusCode ?? -1
                if code < 200 || code >= 300 {
                    if code == 401 {
                        await MainActor.run {
                            auth.handleUnauthorizedResponse()
                        }
                    }
                    let msg = String(data: data, encoding: .utf8) ?? ""
                    throw NSError(domain: "FirmwareUpdateManager", code: code, userInfo: [
                        NSLocalizedDescriptionKey: msg.isEmpty ? "Device claim failed." : msg
                    ])
                }

                let mint = try JSONDecoder().decode(MintResponse.self, from: data)

                await MainActor.run {
                    accountDevices.storeClaimedDevice(
                        boardType: "esp32s3",
                        hardwareUid: hardwareUidHex
                    )
                    self.appendLog((mint.created ?? false) ? "Backend device claim succeeded" : "Backend device restore succeeded")
                    self.appendLog("Stored claimed device locally for immediate access")
                    self.appendLog("Hardware UID: \(hardwareUidHex)")
                    self.progressMessage = "Flashing ESP firmware..."
                }

                try await MainActor.run {
                    try self.startEspSerialUpdate(device: device)
                }
            } catch {
                await MainActor.run {
                    self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.progressMessage = ""
                    self.appendLog(self.updateError ?? "ESP setup failed")
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

    func refreshDfuPresence() {
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

            do {
                let port = try self.detectEspBootloaderPort()
                DispatchQueue.main.async {
                    self.espBootloaderConnected = (port != nil)
                    self.espBootloaderPort = port
                    if port != nil {
                        self.presentedBoardType = "esp32s3"
                    }
                }
            } catch {
                DispatchQueue.main.async {
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
                self?.refreshDfuPresence()
            }
        }
    }

    private func isEspBoardType(_ boardType: String?) -> Bool {
        (boardType ?? "").caseInsensitiveCompare("esp32s3") == .orderedSame
    }

    private func effectiveBoardType(for device: MacUSBManager) -> String {
        if isEspBoardType(presentedBoardType) {
            return "esp32s3"
        }
        if espBootloaderConnected || espBootloaderPort != nil {
            return "esp32s3"
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

    private func espFirmwareURLs() throws -> (bootloader: URL, partitionTable: URL, otaData: URL, app: URL) {
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

        return (
            bootloader: try require("emwaver-esp32s3-bootloader"),
            partitionTable: try require("emwaver-esp32s3-partition-table"),
            otaData: try require("emwaver-esp32s3-ota-data"),
            app: try require("emwaver-esp32s3-app")
        )
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

    private func resolveEspFlashPort() throws -> String {
        if let detected = try detectEspBootloaderPort() {
            return detected
        }

        let ports = try espFlashPortCandidates()
        let preferred = ports.filter { $0.contains("usbmodem") || $0.contains("usbserial") || $0.contains("SLAB_USBtoUART") }
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

    private func detectEspBootloaderPort() throws -> String? {
        let ports = try espFlashPortCandidates()
        let preferred = ports.filter { $0.contains("usbmodem") || $0.contains("usbserial") || $0.contains("SLAB_USBtoUART") }
        let candidates = preferred.isEmpty ? ports : preferred

        for port in candidates {
            let (code, _, _) = try runEspHelperAndWait(arguments: ["chip-id", "--port", port, "--baud", "115200", "--no-stub"])
            if code == 0 {
                return port
            }
        }

        return nil
    }

    private func startEspSerialUpdate(device: MacUSBManager) throws {
        progressMessage = "Preparing ESP serial update..."
        completionMessage = "ESP firmware update complete. Reconnect the device in Run Mode."
        appendLog("ESP32-S3 update selected")
        appendLog("ESP flashing uses the serial helper, not DFU.")
        if device.isConnected {
            appendLog("Run Mode remains separate from flashing; using serial port discovery.")
        }

        let port = try resolveEspFlashPort()
        appendLog("ESP flash port: \(port)")
        try runEspFlash(port: port)
    }

    private func normalizedHardwareUid(_ value: String?) -> String? {
        let normalized = (value ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .uppercased()
        return normalized.isEmpty ? nil : normalized
    }

    private func readEspSerialIdentity() throws -> EspSerialIdentity {
        let port = try resolveEspFlashPort()
        appendLog("ESP identity port: \(port)")

        let (code, stdout, stderr) = try runEspHelperAndWait(arguments: [
            "read-identity",
            "--port", port,
            "--baud", "115200",
        ])
        if code != 0 {
            let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: Int(code),
                userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "Failed to read ESP serial identity." : msg]
            )
        }

        func parseKey(_ key: String) -> String? {
            for line in stdout.split(separator: "\n") {
                if line.starts(with: "\(key)=") {
                    return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
            return nil
        }

        guard let hardwareUidHex = normalizedHardwareUid(parseKey("HARDWARE_UID_HEX")) else {
            throw NSError(
                domain: "FirmwareUpdateManager",
                code: 19,
                userInfo: [NSLocalizedDescriptionKey: "ESP serial identity is missing HARDWARE_UID_HEX."]
            )
        }

        let macHex = parseKey("MAC")?.replacingOccurrences(of: ":", with: "").uppercased() ?? ""
        let chipRevision = Int(parseKey("CHIP_REVISION") ?? "") ?? 0
        let featuresHex = (parseKey("FEATURES") ?? "0x0000").uppercased()
        let cores = Int(parseKey("CORES") ?? "") ?? 0

        return EspSerialIdentity(
            hardwareUidHex: hardwareUidHex,
            macHex: macHex,
            chipRevision: chipRevision,
            featuresHex: featuresHex,
            cores: cores
        )
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

    private func runEspFlash(port: String) throws {
        if flashProcess != nil {
            return
        }

        let assets = try espFirmwareURLs()
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
