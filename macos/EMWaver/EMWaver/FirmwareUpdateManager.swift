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
            runFlashAsync()
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
            var detected = false
            while Date() < deadline {
                if Dfu.isConnected() {
                    detected = true
                    break
                }
                Thread.sleep(forTimeInterval: 0.25)
            }

            DispatchQueue.main.async {
                self.dfuConnected = detected

                if !detected {
                    self.progressMessage = ""
                    self.updateError = "Failed to enter Update Mode (DFU not detected)."
                    return
                }

                self.progressMessage = "Preparing update..."
                self.runFlashAsync()
            }
        }
    }

    func refreshDfuPresence() {
        if isFlashing { return }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self else { return }
            let present = Dfu.isConnected()
            DispatchQueue.main.async {
                self.dfuConnected = present
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

    private func runFlashAsync() {
        if isFlashing { return }

        isFlashing = true
        updateError = nil
        updateDone = false
        progressPct = 0
        progressMessage = "Starting mass erase..."

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            do {
                let fw = try self.firmwareURL()
                let data = try Data(contentsOf: fw)

                let dfu = try Dfu.openFirst()
                defer { dfu.close() }

                try dfu.flash(firmware: data, address: 0x0800_0000) { msg, pct in
                    DispatchQueue.main.async {
                        self.progressMessage = msg
                        self.progressPct = pct
                    }
                }

                DispatchQueue.main.async {
                    self.progressPct = 100
                    self.updateDone = true
                    self.isFlashing = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.updateError = String(describing: error)
                    self.isFlashing = false
                }
            }
        }
    }
}
