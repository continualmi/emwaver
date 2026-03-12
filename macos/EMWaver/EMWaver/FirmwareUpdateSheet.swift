import SwiftUI

struct FirmwareUpdateSheet: View {
    @EnvironmentObject var auth: AuthenticationManager
    @ObservedObject var device: MacUSBManager
    @ObservedObject var updater: FirmwareUpdateManager

    @State private var updateModeRequested: Bool = false
    @State private var showingEspBootloaderInstructions: Bool = false

    private var isSecureWorkflow: Bool {
        device.isSecureConnected
    }

    private var boardType: String {
        device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private var isEspWorkflow: Bool {
        boardType.caseInsensitiveCompare("esp32s3") == .orderedSame
    }

    private var canStartPrimaryAction: Bool {
        if updater.isFlashing {
            return false
        }
        if !isSecureWorkflow {
            return device.isConnected && auth.isSignedIn
        }
        if isEspWorkflow {
            return true
        }
        return device.isConnected || updater.dfuConnected
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(isSecureWorkflow ? "Update EMWaver" : "Activate EMWaver")
                        .font(.title3.weight(.semibold))
                    Text(isSecureWorkflow
                         ? "Update your device to the latest EMWaver version."
                         : "Mint the device with the backend, flash bundled firmware, and write its signed identity.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Close") {
                    updater.dismiss()
                }
                .disabled(updater.isFlashing)
            }

            if device.isConnected, !updater.updateDone {
                VStack(alignment: .leading, spacing: 8) {
                    Text(device.isSecureConnected ? "Device connected (Secure)." : "Device connected (Not secure).")
                        .font(.subheadline.weight(.semibold))

                    if let v = device.deviceEmwaverVersion, !v.isEmpty {
                        Text("Detected version: EMWaver \(v)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if isEspWorkflow {
                        Text("ESP32-S3 updates use serial flashing. Put the board into bootloader mode manually before starting the update.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if device.isSecureConnected {
                        Text("To update: EMWaver will switch the device into Update Mode automatically (no switch needed).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("This board is not activated yet. Activation uses the backend minting flow to issue a valid DeviceID + Proof before the app provisions firmware in Update Mode.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if !auth.isSignedIn {
                            Text("Sign in to mint and activate this device.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    HStack {
                        Spacer()
                    }
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.secondary.opacity(0.08))
                )
            }

            GroupBox("Verification") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Run authenticity checks in both Run Mode and Update Mode.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack {
                        Button("Verify in Run Mode") {
                            updater.verifyRunModeIdentity(device: device)
                        }
                        .disabled(!device.isConnected || updater.isFlashing)

                        Button("Verify in Update Mode") {
                            updater.verifyUpdateModeIdentity()
                        }
                        .disabled(isEspWorkflow || !updater.dfuConnected || updater.isFlashing)
                    }

                    if let verification = updater.lastVerification {
                        Text(verification.ok ? "Certified original EMWaver device." : "Device is not certified.")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(verification.ok ? Color.green : Color.red)

                        Text(verification.transport)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            GroupBox("Firmware source") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Button(updater.firmwareSourceUsesCustom ? "Use bundled firmware" : "Use custom firmware…") {
                            updater.toggleFirmwareSource()
                        }
                        .disabled(updater.isFlashing)

                        if updater.firmwareSourceUsesCustom {
                            Button("Select .bin…") {
                                updater.selectCustomFirmware()
                            }
                            .disabled(updater.isFlashing)
                        }
                    }

                    Text("Current firmware: \(updater.firmwareSummary)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 4)
            }

            if isEspWorkflow && !updater.updateDone {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Put the ESP32-S3 into bootloader mode")
                        .font(.subheadline.weight(.semibold))

                    Text("Use the BOOT and RESET buttons before starting the update. EMWaver will flash the serial port after the board is already in bootloader mode.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button("Show bootloader steps") {
                        showingEspBootloaderInstructions = true
                    }
                    .disabled(updater.isFlashing)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.secondary.opacity(0.08))
                )
            } else if !updater.dfuConnected && !updater.updateDone {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Put the device into Update Mode")
                        .font(.subheadline.weight(.semibold))

                    if !updateModeRequested {
                        Text("1) Plug in your EMWaver device.\n2) Click Enter Update Mode.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Button("Enter Update Mode") {
                            updateModeRequested = true
                            device.requestEnterUpdateMode()
                            device.disconnect()
                        }
                        .disabled(!device.isConnected || updater.isFlashing)

                        Text("After you click Enter Update Mode, you must unplug and plug the device back in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Now unplug and plug the device back in.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Button("I replugged it") {
                            updater.refreshDfuPresence()
                        }
                        .disabled(updater.isFlashing)

                        Text("Waiting for Update Mode…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.secondary.opacity(0.08))
                )
            }

            if isEspWorkflow && firmwareUpdaterHasEspBootloader && !updater.updateDone {
                Text(espBootloaderDetectedText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.orange.opacity(0.12))
                    )
            } else if updater.dfuConnected && !updater.updateDone {
                Text("Device detected in Update Mode.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.orange.opacity(0.12))
                    )
            }

            if let err = updater.updateError, !err.isEmpty {
                // Text views aren't selectable by default, which makes debugging painful.
                // Keep this selectable so errors can be copied.
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

            GroupBox("Activity log") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Latest provisioning and verification details.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Clear") {
                            updater.clearLogs()
                        }
                        .disabled(updater.isFlashing)
                    }

                    ScrollView {
                        Text(updater.logLines.isEmpty ? "No activity yet." : updater.logLines.joined(separator: "\n"))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(minHeight: 140, maxHeight: 180)
                }
                .padding(.vertical, 4)
            }

            if updater.updateDone {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Color.green)
                    Text(updater.completionMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.green.opacity(0.12))
                )
            }

            Spacer(minLength: 0)

            HStack {
                Spacer()
                if !updater.updateDone {
                    Button(isSecureWorkflow ? "Update device" : "Mint and activate device") {
                        if isSecureWorkflow {
                            updater.startUpdate(device: device)
                        } else {
                            updater.startMintAndProvision(auth: auth, device: device)
                        }
                    }
                    .disabled(!canStartPrimaryAction)
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 560, minHeight: 640)
        .onAppear {
            updateModeRequested = false
            updater.refreshDfuPresence()
        }
        .sheet(isPresented: $showingEspBootloaderInstructions) {
            EspBootloaderInstructionsSheet()
        }
    }

    private var firmwareUpdaterHasEspBootloader: Bool {
        updater.espBootloaderConnected
    }

    private var espBootloaderDetectedText: String {
        if let port = updater.espBootloaderPort, !port.isEmpty {
            return "ESP bootloader detected on \(port)."
        }
        return "ESP bootloader detected."
    }
}
