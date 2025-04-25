import SwiftUI

struct BadUSBView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var scriptText = ""
    @State private var status = "Ready"
    
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                // Connection Status
                GroupBox(label: Label("Connection", systemImage: "antenna.radiowaves.left.and.right").font(.headline)) {
                    HStack {
                        Circle()
                            .fill(bleManager.isConnected ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(bleManager.isConnected ? "Connected" : "Not Connected")
                            .font(.subheadline)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Script Editor
                GroupBox(label: Label("Script", systemImage: "doc.text").font(.headline)) {
                    TextEditor(text: $scriptText)
                        .frame(minHeight: 200)
                        .font(.system(.body, design: .monospaced))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                        )
                        .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Controls
                GroupBox(label: Label("Controls", systemImage: "keyboard").font(.headline)) {
                    VStack(spacing: 12) {
                        Button(action: {
                            status = "Script loaded"
                            // Placeholder for actual functionality
                        }) {
                            HStack {
                                Image(systemName: "arrow.up.doc")
                                Text("Load Script")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.blue.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                        
                        Button(action: {
                            status = "Script running..."
                            // Placeholder for actual functionality
                        }) {
                            HStack {
                                Image(systemName: "play.fill")
                                Text("Run Script")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.green.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Status
                GroupBox(label: Label("Status", systemImage: "info.circle").font(.headline)) {
                    Text(status)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("Bad-USB")
    }
}

#Preview {
    NavigationView {
        BadUSBView()
            .environmentObject(BLEManager())
    }
} 