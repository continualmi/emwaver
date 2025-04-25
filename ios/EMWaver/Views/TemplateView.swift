import SwiftUI

struct TemplateView: View {
    var body: some View {
        Text("Template View Content")
            .navigationTitle("Template")
    }
}

#Preview {
    NavigationView {
        TemplateView()
    }
} 