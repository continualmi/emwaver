import SwiftUI

struct CloudSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var backendURL: String = ""
    @State private var showSavedToast = false

    private var envBackendURL: String {
        (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Backend") {
                    if !envBackendURL.isEmpty {
                        Text("This build is using EMWAVER_BACKEND_URL from the environment. The field below is ignored until that env var is removed.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }

                    TextField("https://api.emwavers.com", text: $backendURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .keyboardType(.URL)

                    Button("Save") {
                        CloudConfig.setBackendBaseURLString(backendURL)
                        showSavedToast = true
                    }
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
            .onAppear {
                // If env is set, show it, but allow editing persisted value for later.
                if let persisted = UserDefaults.standard.string(forKey: "emwaver.cloud.backend_url") {
                    backendURL = persisted
                } else if let legacy = UserDefaults.standard.string(forKey: "emwaver.agent.backendURL") {
                    backendURL = legacy
                } else {
                    backendURL = ""
                }
            }
            .alert("Saved", isPresented: $showSavedToast) {
                Button("OK") {}
            }
        }
    }
}

#Preview {
    CloudSettingsSheet()
}
