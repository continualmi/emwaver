import SwiftUI

struct WebSignInHandoffSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("EMWaver API Key")
                .font(.title2)
                .fontWeight(.semibold)

            Text("The old web handoff code flow has been replaced. Create or replace your EMWaver key on the web, then paste that key into the app.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Button("Close") { dismiss() }

                Spacer()

                Button("Open Web Account") {
                    auth.openAccountManagement()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}

#Preview {
    WebSignInHandoffSheet()
        .environmentObject(AuthenticationManager())
}
