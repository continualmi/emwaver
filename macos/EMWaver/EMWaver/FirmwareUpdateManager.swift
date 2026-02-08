import Foundation
import Combine
import CryptoKit

final class FirmwareUpdateManager: ObservableObject {
    private var preservedIdentity: MacUSBManager.DeviceIdentity? = nil

    @Published var isPresented: Bool = false
    @Published var dfuConnected: Bool = false
    @Published var isFlashing: Bool = false
    @Published var progressPct: Double = 0
    @Published var progressMessage: String = ""
    @Published var updateError: String? = nil
    @Published var updateDone: Bool = false

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
        isPresented = true
    }

    func dismiss() {
        isPresented = false
    }

    func startUpdate(device: MacUSBManager) {
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Preparing update..."

        if isFlashing {
            return
        }

        // Gate: only secured devices can be updated.
        // For run-mode devices we can use the already-verified secure connection state.
        if device.isConnected && !device.isSecureConnected {
            updateError = "Firmware update blocked: device is not secured."
            return
        }

        // If DFU is already present, verify DFU identity page before flashing.
        if dfuConnected {
            preservedIdentity = nil
            do {
                try gateOnDfuIdentityOrFail()
                try runFlash()
            } catch {
                updateError = String(describing: error)
                isFlashing = false
            }
            return
        }

        // Otherwise, ask the connected device to enter DFU.
        if device.isConnected {
            // Note: identity preservation + gating happens via DFU page upload (not run-mode opcode).
            preservedIdentity = nil

            progressMessage = "Switching device to Update Mode..."
            device.requestEnterUpdateMode()
            device.disconnect()
        } else {
            updateError = "Connect a device in Run mode, then retry the update."
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
                    let (code, _stdout, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
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
                    return
                }

                self.progressMessage = "Preparing update..."
                self.preservedIdentity = nil
                do {
                    try self.gateOnDfuIdentityOrFail()
                    try self.runFlash()
                } catch {
                    self.updateError = String(describing: error)
                    self.isFlashing = false
                }
            }
        }
    }

    func startRecovery(auth: AuthenticationManager, device: MacUSBManager) {
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Recovering device identity..."

        guard let session = auth.session else {
            updateError = "Sign in to recover device identity."
            return
        }
        guard let baseURL = BackendUrl.resolve() else {
            updateError = "Missing backend URL (configure backend first)."
            return
        }

        // Step 1: request a new DeviceID+Proof.
        struct MintResponse: Decodable {
            let device_id_b64: String
            let proof_b64: String
        }

        Task {
            do {
                let url = baseURL.appendingPathComponent("provisioning/mint")
                var req = URLRequest(url: url)
                req.httpMethod = "POST"
                req.setValue("Bearer \(session.idToken)", forHTTPHeaderField: "Authorization")

                let (data, res) = try await URLSession.shared.data(for: req)
                let code = (res as? HTTPURLResponse)?.statusCode ?? -1
                if code < 200 || code >= 300 {
                    let msg = String(data: data, encoding: .utf8) ?? ""
                    throw NSError(domain: "FirmwareUpdateManager", code: code, userInfo: [NSLocalizedDescriptionKey: "Mint failed: \(msg)"])
                }
                let mint = try JSONDecoder().decode(MintResponse.self, from: data)

                // Step 2: enter DFU and write only the identity page.
                await MainActor.run {
                    self.progressMessage = "Switching device to Update Mode..."
                }

                if device.isConnected {
                    device.requestEnterUpdateMode()
                    device.disconnect()
                }

                // Wait for DFU.
                var detected = false
                let deadline = Date().addingTimeInterval(8.0)
                while Date() < deadline {
                    let (code, _stdout, _stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
                    if code == 0 {
                        detected = true
                        break
                    }
                    try await Task.sleep(nanoseconds: 250_000_000)
                }

                if !detected {
                    throw NSError(domain: "FirmwareUpdateManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "DFU not detected"])
                }

                await MainActor.run {
                    self.progressMessage = "Writing identity page..."
                }

                let (code2, _stdout2, stderr) = try self.runHelperAndWait(arguments: [
                    "write-identity",
                    "--device-id-b64",
                    mint.device_id_b64,
                    "--proof-b64",
                    mint.proof_b64,
                ])
                if code2 != 0 {
                    throw NSError(domain: "FirmwareUpdateManager", code: Int(code2), userInfo: [NSLocalizedDescriptionKey: stderr])
                }

                await MainActor.run {
                    self.progressMessage = "Identity recovered. Reconnect device and retry update."
                }
            } catch {
                await MainActor.run {
                    self.updateError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    self.progressMessage = ""
                }
            }
        }
    }

    func refreshDfuPresence() {
        if isFlashing { return }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            do {
                let (code, _stdout, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
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

    private func helperURL() throws -> URL {
        if let url = Bundle.main.url(forResource: "emwaver-dfu-helper", withExtension: nil) {
            return url
        }
        throw NSError(
            domain: "FirmwareUpdateManager",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Missing bundled DFU helper (emwaver-dfu-helper)."]
        )
    }

    private func firmwareURL() throws -> URL {
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

    private func gateOnDfuIdentityOrFail() throws {
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
              let proofB64 = parseKey("PROOF_B64"),
              let deviceId = Data(base64Encoded: devB64), deviceId.count == 16,
              let proof = Data(base64Encoded: proofB64), proof.count == 64 else {
            throw NSError(domain: "FirmwareUpdateManager", code: 12, userInfo: [NSLocalizedDescriptionKey: "Device identity page is malformed"])
        }

        if !pk.isValidSignature(proof, for: deviceId) {
            throw NSError(domain: "FirmwareUpdateManager", code: 13, userInfo: [NSLocalizedDescriptionKey: "Device identity proof is invalid"])
        }

        preservedIdentity = MacUSBManager.DeviceIdentity(deviceId: deviceId, proof: proof)
    }

    private func runFlash() throws {
        if flashProcess != nil {
            return
        }

        isFlashing = true

        let fw = try firmwareURL()

        let process = Process()
        process.executableURL = try helperURL()
        process.arguments = ["flash", "--firmware", fw.path]

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
                    // Restore identity page after DFU flash (ROM DFU mass erase wipes it).
                    if let ident = self.preservedIdentity {
                        do {
                            self.progressMessage = "Restoring device identity..."
                            let (code3, _stdout3, stderr3) = try self.runHelperAndWait(arguments: [
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
                            return
                        }
                    }

                    self.progressPct = 100
                    self.updateDone = true
                } else {
                    let err = String(data: self.flashStderrBuffer, encoding: .utf8) ?? ""
                    let msg = err.trimmingCharacters(in: .whitespacesAndNewlines)
                    self.updateError = msg.isEmpty ? "Firmware update failed (exit code: \(code))." : msg
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
}
