import SwiftUI

struct SettingsView: View {
    var body: some View {
        NavigationView {
            Text("Settings View Content")
                .navigationTitle("Settings")
                .navigationBarTitleDisplayMode(.inline)
                .onAppear {
                    // Add this code for opaque navigation bar
                    let appearance = UINavigationBarAppearance()
                    appearance.configureWithOpaqueBackground()
                    UINavigationBar.appearance().standardAppearance = appearance
                    UINavigationBar.appearance().compactAppearance = appearance
                    UINavigationBar.appearance().scrollEdgeAppearance = appearance
                    // End of added code
                }
        }
    }
}

#Preview {
    NavigationView {
        SettingsView()
    }
} 