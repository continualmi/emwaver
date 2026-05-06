import SwiftUI

/// App-level settings hub.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!
    private let accountURL = URL(string: "https://mdl.continualmi.com/account")!

    var body: some View {
        NavigationStack {
            Form {
                Section("Agent") {
                    Text("Agent replies use the Continual MGPT API. Create a key on MDL, buy credits from the same account if needed, then enter the key in EMWaver.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Button("Open MGPT API Keys") {
                        openURL(mgptApiURL)
                    }

                    Button("Open Account & Credits") {
                        openURL(accountURL)
                    }
                }

                Section("Device access") {
                    Text("Local scripts and hardware control work immediately.")
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
