import SwiftUI

/// macOS-only backend selector.
///
/// This is an *actual switch* that overrides any scheme env var, so you can
/// test production vs local without touching Xcode schemes.
struct BackendSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var useProduction: Bool = UserDefaults.standard.bool(forKey: BackendUrl.keyUseProduction)
    @State private var localUrlText: String = UserDefaults.standard.string(forKey: BackendUrl.keyLocalUrl) ?? ""

    private var effectiveUrl: String {
        BackendUrl.effectiveString()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Backend")
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
                Text("Azure (prod)").tag(true)
            }
            .pickerStyle(.segmented)
            .onChange(of: useProduction) { _, _ in
                save()
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Local backend URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextField("http://127.0.0.1:8787", text: $localUrlText)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .disabled(useProduction)

                HStack(spacing: 10) {
                    Button("Use localhost") {
                        localUrlText = "http://127.0.0.1:8787"
                        useProduction = false
                        save()
                    }
                    .disabled(useProduction)

                    Button("Use LAN IP") {
                        // Fill manually if desired; this just makes it obvious.
                        localUrlText = "http://192.168.1.130:8787"
                        useProduction = false
                        save()
                    }
                    .disabled(useProduction)

                    Button("Clear") {
                        localUrlText = ""
                        useProduction = false
                        save()
                    }
                    .disabled(useProduction)
                }
            }

            Spacer(minLength: 0)

            HStack {
                Text("Note: changing backend may require signing in again.")
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
        let d = UserDefaults.standard
        d.set(useProduction, forKey: BackendUrl.keyUseProduction)
        d.set(localUrlText.trimmingCharacters(in: .whitespacesAndNewlines), forKey: BackendUrl.keyLocalUrl)
    }
}

#Preview {
    BackendSettingsView()
}
