import SwiftUI

/// App-level settings hub.
struct SettingsView: View {
    @ObservedObject var device: MacUSBManager
    @Environment(\.dismiss) private var dismiss

    @State private var suppressAttachPrompt: Bool = UserDefaults.standard.bool(forKey: "emwaver.deviceAttachPrompt.suppress")

    var body: some View {
        NavigationStack {
            Form {
                Section("Account") {
                    Toggle("Don't prompt to attach device on connect", isOn: $suppressAttachPrompt)
                        .onChange(of: suppressAttachPrompt) { _, v in
                            UserDefaults.standard.set(v, forKey: "emwaver.deviceAttachPrompt.suppress")
                            if v {
                                device.needsLoginToSaveDevice = false
                            }
                        }

                    Text("You can still attach a device later from the Device panel.")
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
            .frame(minWidth: 720, minHeight: 520)
        }
    }
}

#Preview {
    SettingsView(device: MacUSBManager())
}
