import SwiftUI

/// macOS-only web frontend selector (staff-facing).
/// Uses fixed cloud/local URLs from env.
struct FrontendSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var useProduction: Bool = UserDefaults.standard.bool(forKey: FrontendUrl.keyUseProduction)

    private var effectiveUrl: String {
        FrontendUrl.effectiveString()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Staff Only · Web Frontend")
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
                Text(FrontendUrl.productionAzure)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)

                Text("Local URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(FrontendUrl.localDefault)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)

            HStack {
                Text("Staff-only frontend mode switch.")
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
        UserDefaults.standard.set(useProduction, forKey: FrontendUrl.keyUseProduction)
    }
}

#Preview {
    FrontendSettingsView()
}
