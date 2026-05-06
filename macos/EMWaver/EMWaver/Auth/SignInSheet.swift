import SwiftUI

struct SignInSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var apiKey: String = ""
    @State private var isKeyVisible = false

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!
    private let accountURL = URL(string: "https://mdl.continualmi.com/account")!

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Agent API Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Use a Continual MGPT API key to enable Agent replies. Local scripts and local hardware control stay available without a key.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button("Open MGPT API Keys") {
                    openURL(mgptApiURL)
                }
                .buttonStyle(.bordered)

                Button("Open Account & Credits") {
                    openURL(accountURL)
                }
                .buttonStyle(.bordered)
            }

            if auth.hasSavedKey {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Saved key")
                        .font(.headline)

                    HStack(spacing: 8) {
                        Text(isKeyVisible ? auth.accessToken : maskedKey(auth.accessToken))
                            .font(.system(.body, design: .monospaced))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))

                        Button(isKeyVisible ? "Hide" : "View") {
                            isKeyVisible.toggle()
                        }
                        .buttonStyle(.bordered)
                    }

                    Button(role: .destructive) {
                        Task {
                            await auth.removeKey()
                            apiKey = ""
                            isKeyVisible = false
                        }
                    } label: {
                        Text("Remove Saved Key")
                    }
                }
                .padding(.vertical, 4)

                Divider()
            }

            Text(auth.hasSavedKey ? "Replace key" : "Enter key")
                .font(.headline)

            if isKeyVisible {
                TextField("cmi_live_...", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            } else {
                SecureField("cmi_live_...", text: $apiKey)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
            }

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
                            apiKey = ""
                            isKeyVisible = false
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

    private func maskedKey(_ key: String) -> String {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 10 else {
            return trimmed.isEmpty ? "No key saved" : String(repeating: "•", count: max(trimmed.count, 8))
        }

        let prefix = trimmed.prefix(6)
        let suffix = trimmed.suffix(4)
        return "\(prefix)••••••••\(suffix)"
    }
}
