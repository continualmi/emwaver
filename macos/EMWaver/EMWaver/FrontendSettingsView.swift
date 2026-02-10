import SwiftUI

/// macOS-only web frontend selector.
///
/// Mirrors BackendSettingsView so we can keep a web-first purchase flow for Pro,
/// while still allowing local dev testing.
struct FrontendSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var useProduction: Bool = UserDefaults.standard.bool(forKey: FrontendUrl.keyUseProduction)
    @State private var localUrlText: String = UserDefaults.standard.string(forKey: FrontendUrl.keyLocalUrl) ?? "http://127.0.0.1:3000"

    private var effectiveUrl: String {
        FrontendUrl.effectiveString()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Web Frontend")
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
            .onChange(of: useProduction) { _, _ in save() }

            VStack(alignment: .leading, spacing: 6) {
                Text("Local frontend URL")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextField("http://127.0.0.1:3000", text: $localUrlText)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .disabled(useProduction)

                HStack(spacing: 10) {
                    Button("Use localhost") {
                        localUrlText = "http://127.0.0.1:3000"
                        useProduction = false
                        save()
                    }
                    .disabled(useProduction)

                    Button("Use LAN IP") {
                        localUrlText = "http://192.168.1.130:3000"
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
                Text("Note: Pro purchase is web-first for now. Eligibility is still enforced by the backend.")
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
        d.set(useProduction, forKey: FrontendUrl.keyUseProduction)
        d.set(localUrlText.trimmingCharacters(in: .whitespacesAndNewlines), forKey: FrontendUrl.keyLocalUrl)
    }
}

#Preview {
    FrontendSettingsView()
}
