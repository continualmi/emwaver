import SwiftUI

struct ConsoleView: View {
    var body: some View {
        Text("Console View Content")
            .navigationTitle("Console")
    }
}

#Preview {
    NavigationView {
        ConsoleView()
    }
} 