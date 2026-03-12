import Foundation
import Combine
import CryptoKit
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif

final class FirmwareUpdateManager: ObservableObject {
    struct VerificationResult {
        let ok: Bool
        let transport: String
        let deviceIdB64: String?
        let proofB64: String?
        let details: [String]
    }

    private var preservedIdentity: MacUSBManager.DeviceIdentity? = nil
    private var identityToWriteAfterFlash: MacUSBManager.DeviceIdentity? = nil

    @Published var isPresented: Bool = false
    @Published var dfuConnected: Bool = false
    @Published var isFlashing: Bool = false
    @Published var progressPct: Double = 0
    @Published var progressMessage: String = ""
    @Published var updateError: String? = nil
    @Published var updateDone: Bool = false
    @Published var completionMessage: String = "Update complete. Reconnect the device to use it."
    @Published var logLines: [String] = []
    @Published var firmwareSourceUsesCustom: Bool = false
    @Published var customFirmwarePath: String? = nil
    @Published var lastVerification: VerificationResult? = nil

    private var dfuPollTimer: Timer? = nil

    private var flashProcess: Process? = nil
    private var flashStdoutBuffer = Data()
    private var flashStderrBuffer = Data()

    init() {
        startDfuPolling()
        refreshDfuPresence()
    }

    deinit {
        dfuPollTimer?.invalidate()
        dfuPollTimer = nil
    }

    func present() {
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = ""
        preservedIdentity = nil
        identityToWriteAfterFlash = nil
        completionMessage = "Update complete. Reconnect the device to use it."
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

        if isFlashing {
            return
        }

        let boardType = device.connectedBoardType ?? "stm32f042"
        if isEspBoardType(boardType) {
            do {
                try startEspSerialUpdate(device: device)
            } catch {
                updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                progressMessage = ""
                appendLog(updateError ?? "ESP update failed")
            }
            return
        }

        // Gate: only secured devices can be updated.
        // For run-mode devices we can use the already-verified secure connection state.
        if device.isConnected && !device.isSecureConnected {
            updateError = "Firmware update blocked: device is not secured."
            appendLog(updateError ?? "Update blocked")
            return
        }

        // Prefer preserving identity from Run mode (EMWaver opcode), because DFU_UPLOAD readback
        // is flaky on macOS (Pipe error) and can prevent DFU identity reads.
        if device.isConnected && device.isSecureConnected {
            preservedIdentity = device.readDeviceIdentity(timeoutMs: 900)
            identityToWriteAfterFlash = nil
            if preservedIdentity == nil {
                updateError = "Failed to read device identity in Run mode. Reconnect and retry."
                appendLog(updateError ?? "Identity read failed")
                return
            }
            appendLog("Run-mode identity captured for restore")
        }

        // If DFU is already present, try to gate on DFU identity page (if needed), then flash.
        if dfuConnected {
            do {
                if preservedIdentity == nil {
                    try gateOnDfuIdentityOrFail()
                }
                try runFlash()
            } catch {
                let msg = String(describing: error)
                if msg.contains("req=0x02") || msg.lowercased().contains("pipe error") {
                    updateError = "macOS DFU readback failed (DFU_UPLOAD Pipe error). Connect the device in Run mode first, then click Update so we can preserve identity without DFU readback."
                } else {
                    updateError = msg
                }
                appendLog(updateError ?? "Update failed")
                isFlashing = false
            }
            return
        }

        // Otherwise, ask the connected device to enter DFU.
        if device.isConnected {
            // Note: identity preservation + gating happens via DFU page upload (not run-mode opcode).
            preservedIdentity = nil

            progressMessage = "Switching device to Update Mode..."
            appendLog("Requesting Update Mode from Run Mode")
            device.requestEnterUpdateMode()
            device.disconnect()
        } else {
            updateError = "Connect a device in Run mode, then retry the update."
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
                self.preservedIdentity = nil
                self.identityToWriteAfterFlash = nil
                do {
                    try self.gateOnDfuIdentityOrFail()
                    self.appendLog("DFU identity verified before update")
                    try self.runFlash()
                } catch {
                    self.updateError = String(describing: error)
                    self.appendLog(self.updateError ?? "Update failed")
                    self.isFlashing = false
                }
            }
        }
    }

    func startMintAndProvision(auth: AuthenticationManager, device: MacUSBManager) {
        appendLog("Activation requested")
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Reading hardware UID..."
        completionMessage = "Activation complete. Reconnect the device to use it."

        if isFlashing {
            return
        }

        guard let session = auth.session else {
            updateError = "Sign in to activate this device."
            appendLog(updateError ?? "Activation failed")
            return
        }
        guard let baseURL = BackendUrl.resolve() else {
            updateError = "Missing backend URL (configure backend first)."
            appendLog(updateError ?? "Activation failed")
            return
        }
        if device.isSecureConnected {
            updateError = "Device is already secured. Use Update instead."
            appendLog(updateError ?? "Activation skipped")
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
            updateError = "ESP activation is not wired yet. ESP update now uses serial flashing, but identity provisioning/restore for ESP still needs a board-specific implementation."
            appendLog(updateError ?? "Activation failed")
            return
        }

        // Step 1: claim or restore an identity for this physical board using its hardware UID.
        struct MintResponse: Decodable {
            let device_id_b64: String
            let proof_b64: String
            let board_type: String?
            let hardware_uid: String?
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
                req.setValue("Bearer \(session.idToken)", forHTTPHeaderField: "Authorization")
                req.httpBody = try JSONSerialization.data(withJSONObject: [
                    "board_type": boardType,
                    "hardware_uid": hardwareUidHex,
                ])

                let (data, res) = try await URLSession.shared.data(for: req)
                let code = (res as? HTTPURLResponse)?.statusCode ?? -1
                if code < 200 || code >= 300 {
                    let msg = String(data: data, encoding: .utf8) ?? ""
                    throw NSError(domain: "FirmwareUpdateManager", code: code, userInfo: [NSLocalizedDescriptionKey: "Mint failed: \(msg)"])
                }
                let mint = try JSONDecoder().decode(MintResponse.self, from: data)
                let mintedIdentity = try self.decodeIdentity(deviceIdB64: mint.device_id_b64, proofB64: mint.proof_b64)
                await MainActor.run {
                    self.progressMessage = "Claiming device..."
                    self.appendLog((mint.created ?? false) ? "Backend device claim succeeded" : "Backend device restore succeeded")
                    self.appendLog("Board type: \(boardType)")
                    self.appendLog("Hardware UID: \(hardwareUidHex)")
                    self.appendLog("DeviceID: \(mint.device_id_b64.prefix(16))…")
                    self.appendLog("Proof: \(mint.proof_b64.prefix(16))…")
                }

                // Step 2: enter DFU, flash bundled firmware, then write the minted identity page.
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
                    self.preservedIdentity = nil
                    self.identityToWriteAfterFlash = mintedIdentity
                    self.progressMessage = "Flashing EMWaver firmware..."
                    self.appendLog("Provisioning in Update Mode")
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

    func verifyRunModeIdentity(device: MacUSBManager) {
        updateError = nil
        guard device.isConnected else {
            let msg = "Run Mode verification requires a connected device."
            updateError = msg
            appendLog(msg)
            return
        }
        guard let pk = EmwaverRootKey.publicKey else {
            let msg = "Missing Root public key (EMWAVER_ROOT_PUBLIC_KEY_B64)"
            updateError = msg
            appendLog(msg)
            return
        }
        guard let ident = device.readDeviceIdentity(timeoutMs: 900) else {
            let msg = "Failed to read identity via Run Mode opcode."
            updateError = msg
            appendLog(msg)
            lastVerification = VerificationResult(
                ok: false,
                transport: "Run Mode",
                deviceIdB64: nil,
                proofB64: nil,
                details: [
                    "Method: Run Mode identity opcode (0x07) over USB MIDI",
                    "Identity read failed"
                ]
            )
            return
        }

        let ok = pk.isValidSignature(ident.proof, for: ident.deviceId)
        let port = device.connectedPortName ?? "USB MIDI"
        let result = VerificationResult(
            ok: ok,
            transport: "Run Mode (\(port))",
            deviceIdB64: ident.deviceIdB64,
            proofB64: ident.proofB64,
            details: [
                "Method: Run Mode identity opcode (0x07) over USB MIDI",
                "MIDI port: \(port)",
                "Proof check: Ed25519 verify(DeviceID, Proof) with Root Public Key"
            ]
        )
        lastVerification = result
        appendVerification(result)
        if !ok {
            updateError = "Device proof is invalid."
        }
    }

    func verifyUpdateModeIdentity() {
        updateError = nil
        do {
            let parsed = try readUpdateModeIdentity()
            let result = VerificationResult(
                ok: parsed.ok,
                transport: "Update Mode",
                deviceIdB64: parsed.identity?.deviceIdB64,
                proofB64: parsed.identity?.proofB64,
                details: [
                    "Method: Update Mode identity page read (UPLOAD)",
                    "Proof check: Ed25519 verify(DeviceID, Proof) with Root Public Key"
                ]
            )
            lastVerification = result
            appendVerification(result)
            if !parsed.ok {
                updateError = "Device identity proof is invalid."
            }
        } catch {
            let msg = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            updateError = msg
            appendLog("Update Mode verification failed: \(msg)")
            lastVerification = VerificationResult(
                ok: false,
                transport: "Update Mode",
                deviceIdB64: nil,
                proofB64: nil,
                details: [
                    "Method: Update Mode identity page read (UPLOAD)",
                    msg
                ]
            )
        }
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
        try helperURL(name: "emwaver-esp-helper")
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

    private func readUpdateModeIdentity() throws -> (identity: MacUSBManager.DeviceIdentity?, ok: Bool) {
        guard let pk = EmwaverRootKey.publicKey else {
            throw NSError(domain: "FirmwareUpdateManager", code: 10, userInfo: [NSLocalizedDescriptionKey: "Missing Root public key (EMWAVER_ROOT_PUBLIC_KEY_B64)"])
        }

        let (code, stdout, stderr) = try runHelperAndWait(arguments: ["read-identity"])
        if code != 0 {
            let msg = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            throw NSError(domain: "FirmwareUpdateManager", code: Int(code), userInfo: [NSLocalizedDescriptionKey: msg.isEmpty ? "Failed to read identity page via DFU" : msg])
        }

        func parseKey(_ key: String) -> String? {
            for line in stdout.split(separator: "\n") {
                if line.starts(with: "\(key)=") {
                    return String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
            return nil
        }

        guard let hasHeader = parseKey("HAS_HEADER"), hasHeader == "1" else {
            throw NSError(domain: "FirmwareUpdateManager", code: 11, userInfo: [NSLocalizedDescriptionKey: "Device is not secured (missing identity page)"])
        }
        guard let devB64 = parseKey("DEVICE_ID_B64"),
              let proofB64 = parseKey("PROOF_B64") else {
            throw NSError(domain: "FirmwareUpdateManager", code: 12, userInfo: [NSLocalizedDescriptionKey: "Device identity page is malformed"])
        }
        let identity = try decodeIdentity(deviceIdB64: devB64, proofB64: proofB64)
        return (identity, pk.isValidSignature(identity.proof, for: identity.deviceId))
    }

    private func gateOnDfuIdentityOrFail() throws {
        let parsed = try readUpdateModeIdentity()
        guard let identity = parsed.identity else {
            throw NSError(domain: "FirmwareUpdateManager", code: 12, userInfo: [NSLocalizedDescriptionKey: "Device identity page is malformed"])
        }
        if !parsed.ok {
            throw NSError(domain: "FirmwareUpdateManager", code: 13, userInfo: [NSLocalizedDescriptionKey: "Device identity proof is invalid"])
        }
        preservedIdentity = identity
    }

    private func decodeIdentity(deviceIdB64: String, proofB64: String) throws -> MacUSBManager.DeviceIdentity {
        guard let deviceId = Data(base64Encoded: deviceIdB64), deviceId.count == 16 else {
            throw NSError(domain: "FirmwareUpdateManager", code: 14, userInfo: [NSLocalizedDescriptionKey: "Backend returned an invalid DeviceID"])
        }
        guard let proof = Data(base64Encoded: proofB64), proof.count == 64 else {
            throw NSError(domain: "FirmwareUpdateManager", code: 15, userInfo: [NSLocalizedDescriptionKey: "Backend returned an invalid Proof"])
        }
        return MacUSBManager.DeviceIdentity(deviceId: deviceId, proof: proof)
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

    private func runFlash() throws {
        if flashProcess != nil {
            return
        }

        isFlashing = true

        let fw = try firmwareURL()
        appendLog("Flashing firmware: \(fw.lastPathComponent)")

        let process = Process()
        process.executableURL = try helperURL()
        // DFU_UPLOAD verification is flaky on macOS (Pipe error). Disable temporarily.
        process.arguments = ["flash", "--firmware", fw.path, "--no-verify"]

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        flashStdoutBuffer = Data()
        flashStderrBuffer = Data()
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
                    // Restore or mint the identity page after DFU flash (ROM DFU mass erase wipes it).
                    if let ident = self.identityToWriteAfterFlash ?? self.preservedIdentity {
                        do {
                            self.progressMessage = "Restoring device identity..."
                            self.appendLog("Writing identity page")
                            let (code3, _, stderr3) = try self.runHelperAndWait(arguments: [
                                "write-identity",
                                "--device-id-b64",
                                ident.deviceIdB64,
                                "--proof-b64",
                                ident.proofB64
                            ])
                            if code3 != 0 {
                                throw NSError(domain: "FirmwareUpdateManager", code: Int(code3), userInfo: [NSLocalizedDescriptionKey: stderr3])
                            }
                        } catch {
                            self.updateError = "Firmware flashed, but failed to restore device identity: \(error)"
                            self.appendLog(self.updateError ?? "Identity restore failed")
                            return
                        }
                    }

                    self.progressPct = 100
                    self.updateDone = true
                    self.progressMessage = ""
                    self.identityToWriteAfterFlash = nil
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

        while true {
            guard let nlRange = flashStdoutBuffer.range(of: Data([0x0A])) else { break }
            let lineData = flashStdoutBuffer.subdata(in: 0..<nlRange.lowerBound)
            flashStdoutBuffer.removeSubrange(0..<nlRange.upperBound)

            let line = (String(data: lineData, encoding: .utf8) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            appendLog(line)
            handleProgressLine(line)
        }
    }

    private func handleProgressLine(_ line: String) {
        progressMessage = line.replacingOccurrences(of: #"\s*\(\d+%\)\s*$"#, with: "", options: .regularExpression)

        if let m = line.range(of: #"\((\d+)%\)"#, options: .regularExpression) {
            let s = String(line[m])
            let digits = s
                .replacingOccurrences(of: "(", with: "")
                .replacingOccurrences(of: ")", with: "")
                .replacingOccurrences(of: "%", with: "")
            if let pct = Int(digits) {
                progressPct = Double(max(0, min(100, pct)))
            }
        }
    }

    private func appendVerification(_ result: VerificationResult) {
        appendLog("Verify (\(result.transport)): \(result.ok ? "CERTIFIED" : "NOT CERTIFIED")")
        for line in result.details {
            appendLog(line)
        }
        if let id = result.deviceIdB64 {
            appendLog("DeviceID: \(id.prefix(16))…")
        }
        if let proof = result.proofB64 {
            appendLog("Proof: \(proof.prefix(16))…")
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
