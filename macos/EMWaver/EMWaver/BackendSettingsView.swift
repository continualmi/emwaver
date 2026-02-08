import SwiftUI

/// macOS-only backend URL selector.
///
/// Backend URL resolution order across the app:
/// 1) EMWAVER_BACKEND_URL env var (if set in scheme)
/// 2) UserDefaults key: emwaver.agent.backendURL
///
/// This view edits #2.
struct BackendSettingsView: View {
    static let userDefaultsKey = "emwaver.agent.backendURL"
    static let azureProductionUrl = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io"

    @Environment(\.dismiss) private var dismiss

    @State private var urlText: String = UserDefaults.standard.string(forKey: userDefaultsKey) ?? ""

    private var envUrl: String {
        (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var effectiveUrl: String {
        let raw = !envUrl.isEmpty ? envUrl : urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        return raw
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Backend")
                .font(.title3)
                .fontWeight(.semibold)

            if !envUrl.isEmpty {
                Text("This build is using EMWAVER_BACKEND_URL from the environment. The setting below is ignored until that env var is removed.")
                    .foregroundStyle(.secondary)
                    .font(.callout)
            }

            Group {
                Text("Effective")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(effectiveUrl.isEmpty ? "(not set)" : effectiveUrl)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }

            Divider()

            Text("Backend URL (saved)")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("https://…", text: $urlText)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .disabled(!envUrl.isEmpty)

            HStack(spacing: 10) {
                Button("Use Azure (prod)") {
                    urlText = Self.azureProductionUrl
                    save()
                }
                .disabled(!envUrl.isEmpty)

                Button("Clear") {
                    urlText = ""
                    save()
                }
                .disabled(!envUrl.isEmpty)

                Spacer()

                Button("Done") {
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }

            Text("Note: changing backend may require signing in again.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(width: 560)
    }

    private func save() {
        UserDefaults.standard.set(urlText.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Self.userDefaultsKey)
    }
}

#Preview {
    BackendSettingsView()
}
