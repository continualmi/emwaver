import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @Environment(\.dismiss) private var dismiss

    @State private var selectedPort: String? = nil

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
                    Toggle("Auto-connect", isOn: $device.autoConnectEnabled)

                    HStack(spacing: 10) {
                        Button("Refresh ports") {
                            device.refreshPorts()
                        }

                        Spacer()

                        Button("Disconnect") {
                            device.disconnect()
                        }
                        .disabled(!device.isConnected)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Ports")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Picker("", selection: Binding(
                            get: {
                                selectedPort ?? device.connectedPortName ?? device.availablePorts.first
                            },
                            set: { newValue in
                                selectedPort = newValue
                            }
                        )) {
                            if device.availablePorts.isEmpty {
                                Text("No ports found").tag(Optional<String>.none)
                            } else {
                                ForEach(device.availablePorts, id: \.self) { port in
                                    Text(port).tag(Optional(port))
                                }
                            }
                        }
                        .labelsHidden()

                        HStack {
                            Button("Connect") {
                                if let p = selectedPort ?? device.connectedPortName ?? device.availablePorts.first {
                                    device.connect(portName: p)
                                }
                            }
                            .disabled(device.availablePorts.isEmpty)

                            Spacer()

                            if device.isConnected {
                                Text("Connected")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }

            GroupBox("Firmware") {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Button("Update firmware…") {
                            firmwareUpdater.present()
                        }

                        Spacer()

                        Button("Refresh update mode") {
                            firmwareUpdater.refreshDfuPresence()
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

                    if let err = firmwareUpdater.updateError, !err.isEmpty {
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
        .frame(minWidth: 520, minHeight: 420)
        .onAppear {
            firmwareUpdater.refreshDfuPresence()
            device.refreshPorts()
            selectedPort = device.connectedPortName
        }
    }
}
