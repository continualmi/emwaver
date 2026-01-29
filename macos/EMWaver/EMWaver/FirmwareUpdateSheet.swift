import SwiftUI

struct FirmwareUpdateSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var updater: FirmwareUpdateManager

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
                    Text("Device connected in Run mode.")
                        .font(.subheadline.weight(.semibold))

                    if let v = device.deviceEmwaverVersion, !v.isEmpty {
                        Text("Detected version: EMWaver \(v)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text("To update: disconnect/unplug, flip the Update switch to Update, reconnect, and wait for EMWaver to detect Update Mode.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack {
                        Button("Disconnect") {
                            device.disconnect()
                        }
                        .disabled(updater.isFlashing)

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

                    Text("Unplug, flip the Update switch to Update, plug back in, and wait for EMWaver to detect it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 10) {
                        Label("Update mode", systemImage: "gearshape")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("|")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Label("Run mode", systemImage: "play.fill")
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
                Text("Device connected in Update Mode.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.orange.opacity(0.12))
                    )
            }

            if let err = updater.updateError, !err.isEmpty {
                Text(err)
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
                    Text("Update complete. Unplug the device, flip the Update switch to Run, and reconnect.")
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
                        // Ensure we are not holding the MIDI device while entering Update Mode.
                        device.disconnect()
                        updater.startUpdate()
                    }
                    .disabled(!updater.dfuConnected || updater.isFlashing)
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 360)
        .onAppear {
            updater.refreshDfuPresence()
        }
    }
}
