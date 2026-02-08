import SwiftUI

struct CloudSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    Text("Backend is fixed to production.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Text(CloudConfig.productionBackend)
                        .font(.system(.callout, design: .monospaced))
                        .textSelection(.enabled)
                }

                Section("Developer") {
                    Toggle("Allow anonymous sync (EMWAVER_ALLOW_ANON_SYNC=1)", isOn: .constant(CloudConfig.allowAnonSync()))
                        .disabled(true)
                    Text("Anonymous sync is controlled by an environment variable for local dev parity with macOS.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Cloud Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    CloudSettingsSheet()
}
