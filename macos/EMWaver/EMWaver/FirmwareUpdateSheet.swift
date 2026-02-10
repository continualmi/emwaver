import SwiftUI

struct FirmwareUpdateSheet: View {
    @EnvironmentObject var auth: AuthenticationManager
    @ObservedObject var device: MacUSBManager
    @ObservedObject var updater: FirmwareUpdateManager

    @State private var updateModeRequested: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Update EMWaver")
                        .font(.title3.weight(.semibold))
                    Text("Update your device to the latest EMWaver version.")
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

                    if device.isSecureConnected {
                        Text("To update: EMWaver will switch the device into Update Mode automatically (no switch needed).")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Firmware update is blocked until the device is secured.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if auth.isSignedIn {
                            Button("Recover device identity") {
                                updater.startRecovery(auth: auth, device: device)
                            }
                            .disabled(updater.isFlashing)
                            .font(.caption)
                        } else {
                            Text("Sign in to recover a device identity.")
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

            if !updater.dfuConnected && !updater.updateDone {
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

            if updater.dfuConnected && !updater.updateDone {
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

            if updater.updateDone {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Color.green)
                    Text("Update complete. Reconnect the device to use it.")
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
                    Button("Update device") {
                        updater.startUpdate(device: device)
                    }
                    .disabled((!device.isConnected && !updater.dfuConnected) || updater.isFlashing || (device.isConnected && !device.isSecureConnected))
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 360)
        .onAppear {
            updateModeRequested = false
            updater.refreshDfuPresence()
        }
    }
}
