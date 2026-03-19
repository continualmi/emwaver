import SwiftUI

/// App-level settings hub.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Device access") {
                    Text("Claimed-device access is keyed by board type and hardware UID.")
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
    SettingsView()
}
