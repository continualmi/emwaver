import SwiftUI

/// macOS-only backend selector (staff-facing).
///
/// Uses fixed cloud/local URLs from env (`EMWAVER_BACKEND_URL_CLOUD` / `EMWAVER_BACKEND_URL_LOCAL`).
struct BackendSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var useProduction: Bool = UserDefaults.standard.bool(forKey: BackendUrl.keyUseProduction)

    private var effectiveUrl: String {
        BackendUrl.effectiveString()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Staff Only · Backend")
                .font(.title3)
                .fontWeight(.semibold)

            Group {
                Text("Effective")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(effectiveUrl.isEmpty ? "(not set)" : effectiveUrl)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }

            Divider()

            Picker("Mode", selection: $useProduction) {
                Text("Local").tag(false)
                Text("Cloud").tag(true)
            }
            .pickerStyle(.segmented)
            .onChange(of: useProduction) { _, _ in save() }

            Group {
                Text("Cloud URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(BackendUrl.productionAzure)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)

                Text("Local URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(BackendUrl.localDefault)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)

            HStack {
                Text("Staff-only backend mode switch. Changing backend may require signing in again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(width: 640)
    }

    private func save() {
        UserDefaults.standard.set(useProduction, forKey: BackendUrl.keyUseProduction)
    }
}

#Preview {
    BackendSettingsView()
}
