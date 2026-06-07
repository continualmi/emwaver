import SwiftUI

/// App-level settings hub.
struct SettingsView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var appUpdater: MacAppUpdateController
    @ObservedObject var mcpServer: MacMcpServer
    @Environment(\.dismiss) private var dismiss
    @AppStorage(MacUSBManager.transportDebugLoggingEnabledDefaultsKey) private var transportDebugLoggingEnabled = true
    @AppStorage(MacMcpSettings.enabledKey) private var mcpServerEnabled = false
    @AppStorage(MacMcpSettings.tokenKey) private var mcpServerToken = MacMcpSettings.token

    private let updateFeedURL = URL(string: "https://emwaver.ai/updates/macos/appcast.xml")!

    private var mcpStatusText: String {
        if !mcpServerEnabled {
            return "Disabled"
        }
        if mcpServer.isRunning {
            return "Enabled on loopback"
        }
        if let error = mcpServer.lastErrorText, !error.isEmpty {
            return "Start failed: \(error)"
        }
        return "Starting"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Device access") {
                    Text("Local scripts and hardware control work immediately.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Desktop MCP") {
                    Toggle("Enable local MCP server", isOn: $mcpServerEnabled)
                    LabeledContent("Status", value: mcpStatusText)
                    LabeledContent("Endpoint") {
                        Text(mcpServer.endpointURL)
                            .textSelection(.enabled)
                    }
                    LabeledContent("Token") {
                        HStack {
                            Text(mcpServerToken)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                            Button("Reset") {
                                mcpServerToken = MacMcpSettings.resetToken()
                            }
                        }
                    }
                }

                Section("App") {
                    LabeledContent("Version", value: MacAppBuildInfo.displayVersion)
                    LabeledContent("Build", value: MacAppBuildInfo.buildNumber)
                    if !MacAppBuildInfo.commitShort.isEmpty {
                        LabeledContent("Commit", value: MacAppBuildInfo.commitShort)
                    }

                    Button("Check for Updates…") {
                        appUpdater.checkForUpdates()
                    }
                    .disabled(!appUpdater.updatesConfigured)

                    Text("Updates are checked from \(updateFeedURL.absoluteString). Local scripts and hardware control do not require an account.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Device diagnostics") {
                    Toggle("Log transport packets on ESP serial", isOn: $transportDebugLoggingEnabled)

                    Text("When enabled, ESP32 firmware logs BLE, USB, and Wi-Fi command packets on the serial monitor. If disabled, the app turns firmware transport logging off after it finishes connection metadata checks.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

            }
            .formStyle(.grouped)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onChange(of: transportDebugLoggingEnabled) {
                device.applyTransportDebugPreference()
            }
            .onChange(of: mcpServerEnabled) {
                mcpServer.syncWithSettings()
            }
            .frame(minWidth: 720, minHeight: 520)
        }
    }
}

#Preview {
    SettingsView(device: MacUSBManager(), appUpdater: MacAppUpdateController(), mcpServer: MacMcpServer())
}
