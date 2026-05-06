import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct SignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var auth: AuthenticationManager
    @State private var apiKey = ""

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!
    private let accountURL = URL(string: "https://mdl.continualmi.com/account")!

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Agent API Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Create a Continual API key, add credits if needed, then store the key on this device. Local scripts and hardware control work without it.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button("Create Key") {
                    openURL(mgptApiURL)
                }
                .buttonStyle(.bordered)

                Button("Buy Credits") {
                    openURL(accountURL)
                }
                .buttonStyle(.bordered)
            }

            SecureField("cmi_live_...", text: $apiKey)
                .textContentType(.password)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if let lastError = auth.lastError, !lastError.isEmpty {
                Text(lastError)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Button("Cancel") {
                    dismiss()
                }

                Spacer()

                Button {
                    Task { await auth.saveAgentApiKey(apiKey) }
                } label: {
                    Text("Save Key")
                }
                .buttonStyle(.borderedProminent)
                .disabled(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .onAppear {
            apiKey = ""
            auth.lastError = nil
        }
    }
}

#Preview {
    SignInSheet()
        .environmentObject(AuthenticationManager())
}
