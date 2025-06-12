import SwiftUI

struct SettingsView: View {
    @StateObject private var settingsManager = SettingsManager.shared
    @State private var showingRefreshTimePicker = false
    @State private var showingBufferSizePicker = false
    
    var body: some View {
        List {
            Section("Sampler Settings") {
                // Refresh Time Setting
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Refresh Time")
                            .font(.body)
                        Text("Select the refresh time interval for the sampler")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        showingRefreshTimePicker = true
                    }) {
                        Text(settingsManager.getRefreshTimeDisplay())
                            .foregroundColor(.blue)
                    }
                }
                .padding(.vertical, 4)
                
                // Buffer Size Limit Setting
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Buffer Size Limit")
                            .font(.body)
                        Text("Set maximum buffer size for sampling (each sample is 10µs)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    Button(action: {
                        showingBufferSizePicker = true
                    }) {
                        Text(settingsManager.getBufferSizeLimitDisplay())
                            .foregroundColor(.blue)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Refresh Time",
            isPresented: $showingRefreshTimePicker,
            titleVisibility: .visible
        ) {
            ForEach(settingsManager.refreshTimeOptions) { option in
                Button(option.display) {
                    settingsManager.updateRefreshTime(option.value)
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Select the refresh time interval for the sampler")
        }
        .confirmationDialog(
            "Buffer Size Limit",
            isPresented: $showingBufferSizePicker,
            titleVisibility: .visible
        ) {
            ForEach(settingsManager.bufferSizeLimitOptions) { option in
                Button(option.display) {
                    settingsManager.updateBufferSizeLimit(option.value)
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Set maximum buffer size for sampling")
        }
    }
}

#Preview {
    NavigationView {
        SettingsView()
    }
}