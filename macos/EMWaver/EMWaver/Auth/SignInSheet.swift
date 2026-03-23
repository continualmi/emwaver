import SwiftUI

struct SignInSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign In")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Sign in is optional. Your scripts and signals always stay on this Mac. You can sign in before connecting a device, and EMWaver will sync supported boards automatically once their firmware is installed and the hardware UID is available. Cloud backup, remote access, and expanded Agent features are part of Continual Pro.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

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
                    auth.beginWebSignInHandoff()
                } label: {
                    HStack(spacing: 8) {
                        Text("Continue with Continual")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(auth.isSigningIn)
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}
