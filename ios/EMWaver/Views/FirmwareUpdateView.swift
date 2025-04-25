import SwiftUI

struct FirmwareUpdateView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var selectedFile: String? = nil
    @State private var updateProgress: Float = 0
    @State private var updateStatus = "No update in progress"
    @State private var firmwareVersion = "Unknown"
    
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
                
                // Device Info
                GroupBox(label: Label("Device Information", systemImage: "info.circle").font(.headline)) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Firmware Version: \(firmwareVersion)")
                        
                        Button(action: {
                            // Placeholder for retrieving firmware version
                            firmwareVersion = "1.0.0"
                        }) {
                            Text("Check Version")
                                .padding(.vertical, 8)
                                .padding(.horizontal, 16)
                                .background(Color.blue.opacity(0.8))
                                .foregroundColor(.white)
                                .cornerRadius(8)
                        }
                        .disabled(!bleManager.isConnected)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Firmware Selection
                GroupBox(label: Label("Select Firmware", systemImage: "doc.fill").font(.headline)) {
                    VStack(spacing: 12) {
                        if let selectedFile = selectedFile {
                            Text("Selected: \(selectedFile)")
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            Text("No file selected")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .foregroundColor(.secondary)
                        }
                        
                        Button(action: {
                            // Placeholder for file selection
                            selectedFile = "emwaver_v1.1.0.bin"
                        }) {
                            HStack {
                                Image(systemName: "folder")
                                Text("Browse Files")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.blue.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
                
                // Update Controls
                GroupBox(label: Label("Update", systemImage: "arrow.up.circle").font(.headline)) {
                    VStack(spacing: 12) {
                        // Progress bar
                        VStack(alignment: .leading) {
                            Text("Progress: \(Int(updateProgress * 100))%")
                                .font(.subheadline)
                            
                            ProgressView(value: updateProgress)
                                .progressViewStyle(LinearProgressViewStyle())
                        }
                        
                        // Status text
                        Text(updateStatus)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .foregroundColor(.secondary)
                            .padding(.vertical, 4)
                        
                        // Update button
                        Button(action: {
                            // Placeholder for update functionality
                            updateStatus = "Update started..."
                            
                            // Simulate progress (in real implementation, this would be handled by BLE callbacks)
                            updateProgress = 0
                            
                            // Simulated progress updates
                            for i in 1...10 {
                                DispatchQueue.main.asyncAfter(deadline: .now() + Double(i)) {
                                    updateProgress = Float(i) / 10
                                    if i == 10 {
                                        updateStatus = "Update completed!"
                                    } else {
                                        updateStatus = "Uploading firmware..."
                                    }
                                }
                            }
                        }) {
                            HStack {
                                Image(systemName: "arrow.up.circle")
                                Text("Start Update")
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(Color.green.opacity(0.8))
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(!bleManager.isConnected || selectedFile == nil)
                    }
                    .padding(.vertical, 8)
                }
                .padding(.horizontal)
            }
            .padding(.vertical)
        }
        .navigationTitle("Firmware Update")
        .onAppear {
            if bleManager.isConnected {
                // Placeholder for checking version on appear
                firmwareVersion = "1.0.0"
            }
        }
    }
}

#Preview {
    NavigationView {
        FirmwareUpdateView()
            .environmentObject(BLEManager())
    }
} 