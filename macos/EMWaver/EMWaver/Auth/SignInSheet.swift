import SwiftUI

struct SignInSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("EMWaver API Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Create your EMWaver key on the web, then paste it here. Local scripts and cached activated devices stay on this Mac, but new device activation, cloud sync, remote access, and expanded Agent features require a saved key.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField("emw_sk_...", text: $apiKey)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))

            if let err = auth.lastError, !err.isEmpty {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Button("Not Now") {
                    dismiss()
                }

                Button("Manage on Web") {
                    auth.openAccountManagement()
                }
                .buttonStyle(.bordered)

                Spacer()

                Button {
                    Task {
                        await auth.saveApiKey(apiKey)
                        if auth.isSignedIn {
                            dismiss()
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if auth.isValidatingKey {
                            ProgressView().controlSize(.small)
                        }
                        Text("Save Key")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isValidatingKey)
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}
