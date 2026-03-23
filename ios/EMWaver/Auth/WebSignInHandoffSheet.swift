import SwiftUI

struct WebSignInHandoffSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss

    @State private var code: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign in with Continual")
                .font(.title2)
                .fontWeight(.semibold)

            Text("After signing in on the Continual website, paste the one-time code here to sign into the EMWaver app.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("EMW-XXXXXX", text: $code)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .onChange(of: code) { _, _ in
                    code = code.uppercased().replacingOccurrences(of: " ", with: "")
                }

            if let err = auth.lastError, !err.isEmpty {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Button("Cancel") { dismiss() }

                Spacer()

                Button {
                    Task {
                        await auth.consumeWebHandoffCode(code: code)
                        if auth.isSignedIn {
                            dismiss()
                        }
                    }
                } label: {
                    HStack(spacing: 8) {
                        if auth.isSigningIn {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text("Continue")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isSigningIn)
            }
        }
        .padding(20)
    }
}
