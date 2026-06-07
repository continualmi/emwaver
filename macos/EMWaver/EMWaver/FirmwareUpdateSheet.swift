import SwiftUI

struct FirmwareUpdateSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var updater: FirmwareUpdateManager

    private var boardType: String {
        updater.presentedBoardType ?? updater.espBootloaderBoardType ?? device.connectedBoardType ?? device.lastDetectedBoardType ?? (updater.espBootloaderPort == nil ? "stm32f042" : "esp")
    }

    private var boardDisplayName: String {
        LocalDeviceLabelFormatter.boardDisplayName(boardType)
    }

    private var isEspWorkflow: Bool {
        if updater.espBootloaderConnected || updater.espBootloaderPort != nil {
            return true
        }
        return FirmwareUpdateManager.isEspBoardType(boardType)
    }

    private var canStartEspFlash: Bool {
        device.isConnected || updater.espBootloaderConnected || updater.espBootloaderPort != nil
    }

    private var needsManagedFirmwareInstall: Bool {
        false
    }

    private var isAwaitingUpdateMode: Bool {
        !updater.dfuConnected &&
        !updater.isFlashing &&
        !updater.updateDone &&
        updater.progressMessage.localizedCaseInsensitiveContains("Update Mode")
    }

    private var showReadyToFlashPrompt: Bool {
        updater.dfuConnected &&
        !updater.isFlashing &&
        !updater.updateDone
    }

    private var showPrepareUpdateModePrompt: Bool {
        needsManagedFirmwareInstall &&
        !showReadyToFlashPrompt &&
        !isAwaitingUpdateMode &&
        !updater.updateDone
    }

    private var titleText: String {
        if isEspWorkflow {
            return "Flash \(boardDisplayName)"
        }
        if updater.updateDone {
            return "Reconnect device"
        }
        if showReadyToFlashPrompt {
            return "Flash device"
        }
        if showPrepareUpdateModePrompt || isAwaitingUpdateMode {
            return "Install firmware"
        }
        return "Firmware"
    }

    private var subtitleText: String {
        if isEspWorkflow {
            return "Use the board's flash-capable serial USB connection."
        }
        if updater.updateDone {
            return updater.completionMessage
        }
        if showReadyToFlashPrompt {
            return "The device is in Update Mode and ready to flash."
        }
        if showPrepareUpdateModePrompt {
            return "This firmware can be updated from the local app."
        }
        if isAwaitingUpdateMode {
            return "The app is waiting for the board to appear in Update Mode."
        }
        return "Follow the prompts to keep the device on managed EMWaver firmware."
    }

    var body: some View {
        if isEspWorkflow {
            espBody
        } else {
            stmBody
        }
    }

    private var stmBody: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(titleText)
                        .font(.title3.weight(.semibold))
                    Text(subtitleText)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button(updater.updateDone ? "Done" : "Close") {
                    updater.dismiss()
                }
                .disabled(updater.isFlashing)
            }

            if let errorText = updater.updateError, !errorText.isEmpty {
                statusCard(
                    systemImage: "exclamationmark.triangle.fill",
                    tint: .red,
                    text: errorText
                )
            } else if showPrepareUpdateModePrompt {
                promptCard(
                    title: "Do you want to put this device into Update Mode?",
                    body: "EMWaver can talk to the board. The app can switch it into Update Mode and prepare the local flash flow for you."
                )
            } else if isAwaitingUpdateMode {
                promptCard(
                    title: "Put the device into Update Mode",
                    body: "EMWaver already asked the board to switch. If nothing happens, unplug and reconnect it now so the app can detect Update Mode and offer the flash."
                )
            } else if showReadyToFlashPrompt {
                promptCard(
                    title: "Do you want to flash the device?",
                    body: "The board is connected in Update Mode. Flashing will install the managed EMWaver firmware bundled with this app."
                )
            } else if updater.updateDone {
                statusCard(
                    systemImage: "checkmark.seal.fill",
                    tint: .green,
                    text: "Firmware installed. Disconnect and reconnect the device to continue."
                )
            } else {
                promptCard(
                    title: "Waiting for a firmware action",
                    body: "Connect a supported board in Run Mode or Update Mode and EMWaver will guide the next step."
                )
            }

            if updater.isFlashing {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(updater.progressMessage.isEmpty ? "Flashing firmware..." : updater.progressMessage)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("\(Int(updater.progressPct.rounded()))%")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    ProgressView(value: updater.progressPct, total: 100)
                        .progressViewStyle(.linear)

                    Text("Keep the device connected until flashing completes. EMWaver will tell you when to disconnect and reconnect it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.secondary.opacity(0.08))
                )
            }

            HStack {
                Spacer()

                if updater.updateDone {
                    Button("Done") {
                        updater.dismiss()
                    }
                    .keyboardShortcut(.defaultAction)
                } else if showPrepareUpdateModePrompt {
                    Button("Not now") {
                        updater.dismiss()
                    }

                    Button("Enter Update Mode") {
                        updater.startUpdate(device: device)
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                } else if showReadyToFlashPrompt {
                    Button("Not now") {
                        updater.dismiss()
                    }

                    Button("Flash") {
                        updater.startUpdate(device: device)
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                } else if let errorText = updater.updateError, !errorText.isEmpty {
                    Button("Close") {
                        updater.dismiss()
                    }

                    if device.isConnected || updater.dfuConnected {
                        Button("Try again") {
                            updater.updateError = nil
                            updater.startUpdate(device: device)
                        }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                    }
                } else {
                    Button("Close") {
                        updater.dismiss()
                    }
                }
            }
        }
        .padding(20)
        .frame(width: 520)
        .onAppear {
            updater.refreshDfuPresence()
        }
    }

    private var espBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Flash \(boardDisplayName)")
                            .font(.title3.weight(.semibold))
                        Text("Use the board's flash-capable serial USB connection.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Close") {
                        updater.dismiss()
                    }
                    .disabled(updater.isFlashing)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Serial flash")
                        .font(.subheadline.weight(.semibold))
                    Text(espBootloaderDetectedText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle((updater.espBootloaderConnected || updater.espBootloaderPort != nil) ? Color.green : .secondary)

                    Text("1. Hold BOOT or FLASH if your board needs manual bootloader mode")
                    Text("2. Press and release RESET")
                    Text("3. Release BOOT or FLASH")
                        .padding(.bottom, 4)

                    HStack(spacing: 10) {
                        Button("Refresh") {
                            updater.refreshDfuPresence(includeEspSerialProbe: true)
                        }
                        .disabled(updater.isFlashing)

                        Button("Flash firmware") {
                            updater.startUpdate(device: device)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(updater.isFlashing || !canStartEspFlash)
                    }
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.secondary.opacity(0.08))
                )

                if let err = updater.updateError, !err.isEmpty {
                    Text(err)
                        .textSelection(.enabled)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.red.opacity(0.12))
                        )
                }

                if updater.isFlashing {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(updater.progressMessage.isEmpty ? "Updating..." : updater.progressMessage)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(Int(updater.progressPct.rounded()))%")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        ProgressView(value: updater.progressPct, total: 100)
                            .progressViewStyle(.linear)
                    }
                }

                if updater.updateDone {
                    statusCard(
                        systemImage: "checkmark.seal.fill",
                        tint: .green,
                        text: updater.completionMessage
                    )
                }
            }
            .padding(16)
        }
        .frame(width: 540, height: 420)
        .onAppear {
            updater.refreshDfuPresence(includeEspSerialProbe: true)
        }
    }

    private func promptCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            Text(body)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.secondary.opacity(0.08))
        )
    }

    private func statusCard(systemImage: String, tint: Color, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(tint.opacity(0.12))
        )
    }

    private var espBootloaderDetectedText: String {
        if let port = updater.espBootloaderPort, !port.isEmpty {
            return "\(boardDisplayName) detected on \(port)."
        }
        if updater.espBootloaderConnected {
            return "\(boardDisplayName) detected."
        }
        return "Not detected yet. Put the board in bootloader mode, then click Refresh."
    }
}
