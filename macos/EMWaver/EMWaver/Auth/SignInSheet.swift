import SwiftUI

struct SignInSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Agent API Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Enter an Agent API key to enable Agent replies. Local scripts and local hardware control stay available without a key.")
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
