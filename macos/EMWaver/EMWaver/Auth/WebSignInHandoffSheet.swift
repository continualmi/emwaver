import SwiftUI

/// Web sign-in handoff: user signs in on the EMWaver web frontend, gets a one-time code,
/// and pastes it here to sign the macOS app in.
struct WebSignInHandoffSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss

    @State private var code: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign in with EMWaver")
                .font(.title2)
                .fontWeight(.semibold)

            Text("After signing in on the EMWaver website, paste the one-time code here to sign into the macOS app.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            TextField("EMW-XXXXXX", text: $code)
                .textFieldStyle(.roundedBorder)
                .font(.system(.body, design: .monospaced))
                .onChange(of: code) { _, _ in
                    // Keep it user-friendly.
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
                            ProgressView().controlSize(.small)
                        }
                        Text("Continue")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || auth.isSigningIn)
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}

#Preview {
    WebSignInHandoffSheet()
        .environmentObject(AuthenticationManager())
}
