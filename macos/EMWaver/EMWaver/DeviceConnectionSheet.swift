import SwiftUI

struct DeviceConnectionSheet: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @EnvironmentObject private var auth: AuthenticationManager
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

                    if device.isSecureConnected {
                        Text(device.deviceAttachStatusText ?? "Device verified")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if auth.isSignedIn,
                           let deviceId = device.secureDeviceIdB64,
                           let proof = device.secureDeviceProofB64,
                           !deviceId.isEmpty,
                           !proof.isEmpty {
                            Button("Attach device to my account") {
                                Task { await attachDevice(deviceIdB64: deviceId, proofB64: proof) }
                            }
                            .buttonStyle(.bordered)
                        } else if device.isSecureConnected {
                            Text("Sign in to attach this device to your account for recovery/support.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

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
                    Button(device.isSecureConnected ? "Update firmware…" : "Activate device…") {
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

                    if !device.isSecureConnected {
                        Text("Activation is backend-authoritative: the macOS app requests a signed DeviceID + Proof, then provisions the device in Update Mode.")
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

        }
        .padding(16)
        .frame(minWidth: 520, minHeight: 280)
        .onAppear {
            firmwareUpdater.refreshDfuPresence()
        }
    }

    private func attachDevice(deviceIdB64: String, proofB64: String) async {
        guard let base = BackendUrl.resolve() else {
            device.deviceAttachStatusText = "Missing backend URL"
            return
        }
        guard let tok = auth.session?.idToken, !tok.isEmpty else {
            device.deviceAttachStatusText = "Sign in required"
            return
        }

        device.deviceAttachStatusText = "Attaching…"

        do {
            var url = base
            url.appendPathComponent("v1")
            url.appendPathComponent("devices")
            url.appendPathComponent("attach")

            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("Bearer \(tok)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: [
                "device_id_b64": deviceIdB64,
                "proof_b64": proofB64,
            ])

            let (data, res) = try await URLSession.shared.data(for: req)
            let code = (res as? HTTPURLResponse)?.statusCode ?? -1
            if code < 200 || code >= 300 {
                let msg = String(data: data, encoding: .utf8) ?? ""
                device.deviceAttachStatusText = msg.isEmpty ? "Attach failed (HTTP \(code))" : msg
                return
            }

            device.deviceAttachStatusText = "Device saved to account"
        } catch {
            device.deviceAttachStatusText = error.localizedDescription
        }
    }
}
