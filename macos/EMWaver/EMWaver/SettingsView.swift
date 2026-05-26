import SwiftUI

/// App-level settings hub.
struct SettingsView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var appUpdater: MacAppUpdateController
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage(MacUSBManager.transportDebugLoggingEnabledDefaultsKey) private var transportDebugLoggingEnabled = true

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!
    private let updateFeedURL = URL(string: "https://emwaver.ai/updates/macos/appcast.xml")!

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    Text("Add an MGPT API key to enable Agent replies. Local scripts and hardware control work without a key.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button("MGPT API Platform") {
                        openURL(mgptApiURL)
                    }
                }

                Section("Device access") {
                    Text("Local scripts and hardware control work immediately.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
            .onChange(of: transportDebugLoggingEnabled) { _ in
                device.applyTransportDebugPreference()
            }
            .frame(minWidth: 720, minHeight: 520)
        }
    }
}

#Preview {
    SettingsView(device: MacUSBManager(), appUpdater: MacAppUpdateController())
}
