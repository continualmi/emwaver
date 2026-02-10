import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Environment(\.dismiss) private var dismiss

    private var statusLabel: (text: String, icon: String) {
        if device.isConnected {
            return ("Connected", "cable.connector")
        }
        if firmwareUpdater.dfuConnected {
            return ("Update Mode", "arrow.triangle.2.circlepath")
        }
        return ("Disconnected", "cable.connector.slash")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Device")
                        .font(.title3.weight(.semibold))

                    HStack(spacing: 8) {
                        Label(statusLabel.text, systemImage: statusLabel.icon)

                        if let port = device.connectedPortName, !port.isEmpty {
                            Text(port)
                                .foregroundStyle(.secondary)
                        }

                        if device.isConnected, let v = device.deviceEmwaverVersion, !v.isEmpty {
                            Text("• EMWaver \(v)")
                                .foregroundStyle(.secondary)
                        }

                        if device.isConnected {
                            if device.isSecureConnected {
                                Text("• Secure")
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("• Not secure")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .font(.subheadline)
                }

                Spacer()

                Button("Close") { dismiss() }
            }

            GroupBox("Connection") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("EMWaver connects automatically when the device is plugged in.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    HStack {
                        Button("Disconnect") {
                            device.disconnect()
                        }
                        .disabled(!device.isConnected)

                        Spacer()
                    }
                }
                .padding(.vertical, 4)
            }

            GroupBox("Firmware") {
                VStack(alignment: .leading, spacing: 10) {
                    Button("Update firmware…") {
                        // Avoid sheet-on-sheet. Dismiss the device sheet first,
                        // then present the firmware update sheet from the app root.
                        dismiss()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            firmwareUpdater.present()
                        }
                    }

                    if device.isConnected {
                        Button("Enter Update Mode") {
                            device.requestEnterUpdateMode()
                            device.disconnect()
                            firmwareUpdater.refreshDfuPresence()
                        }
                    }

                    Text(firmwareUpdater.dfuConnected ? "Update Mode: Detected" : "Update Mode: Not detected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            if let err = device.lastErrorText, !err.isEmpty {
                GroupBox("Last error") {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 380)
        .onAppear {
            firmwareUpdater.refreshDfuPresence()
        }
    }
}
