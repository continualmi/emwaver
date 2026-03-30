import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct SignInSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Activation Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("EMWaver activation keys are managed on the web. Use the web account page to create or replace your key, then return here once the native key-based sign-in flow is ready.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button("Not Now") {
                    dismiss()
                }

                Spacer()

                Button {
                    openWebAccount()
                    dismiss()
                } label: {
                    Text("Open Web Account")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
    }

    private func openWebAccount() {
        guard let base = CloudConfig.backendBaseURL() else {
            return
        }
        var url = base
        url.appendPathComponent("cloud")
#if canImport(UIKit)
        UIApplication.shared.open(url)
#endif
    }
}

#Preview {
    SignInSheet()
}
