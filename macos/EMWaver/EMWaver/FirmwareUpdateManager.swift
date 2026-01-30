import Foundation
import Combine

final class FirmwareUpdateManager: ObservableObject {
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
        // Keep Update Mode presence fresh even when the sheet is closed,
        // so the top menu bar status stays accurate.
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

        // If DFU is already present, flash immediately.
        if dfuConnected {
            do {
                try runFlash()
            } catch {
                updateError = String(describing: error)
            }
            return
        }

        // Otherwise, ask the connected device to enter DFU.
        if device.isConnected {
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
                    let (code, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
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
                do {
                    try self.runFlash()
                } catch {
                    self.updateError = String(describing: error)
                    self.isFlashing = false
                }
            }
        }
    }

    func refreshDfuPresence() {
        if isFlashing { return }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            do {
                let (code, stderr) = try self.runHelperAndWait(arguments: ["is-connected"])
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

    private func stopDfuPolling() {
        dfuPollTimer?.invalidate()
        dfuPollTimer = nil
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

    private func runHelperAndWait(arguments: [String]) throws -> (terminationStatus: Int32, stderr: String) {
        let process = Process()
        process.executableURL = try helperURL()
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
        let stderrStr = String(data: stderrData, encoding: .utf8) ?? ""
        return (process.terminationStatus, stderrStr)
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
