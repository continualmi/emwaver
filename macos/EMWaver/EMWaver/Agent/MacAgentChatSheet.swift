import SwiftUI

struct MacAgentChatSheet: View {
    @ObservedObject var auth: AuthenticationManager
    @StateObject private var vm: MacAgentChatViewModel

    init(auth: AuthenticationManager) {
        self.auth = auth
        _vm = StateObject(wrappedValue: MacAgentChatViewModel(idTokenProvider: { auth.session?.idToken ?? "" }))
    }

    var body: some View {
        VStack(spacing: 0) {
            if !auth.isSignedIn {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sign in required")
                        .font(.headline)
                    Text("Agent chat uses your account to store conversations and requires an access token.")
                        .foregroundStyle(.secondary)
                        .font(.callout)

                    HStack {
                        Button("Sign In") {
                            auth.isSignInSheetPresented = true
                        }
                        Spacer()
                    }
                }
                .padding(16)

                Divider()
            }

            MacAgentChatPanelView(viewModel: vm)
        }
        .sheet(isPresented: $auth.isSignInSheetPresented) {
            SignInSheet()
                .environmentObject(auth)
        }
    }
}
