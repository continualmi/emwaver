/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import SwiftUI

struct SettingsView: View {
    @StateObject private var settingsManager = SettingsManager.shared
    @State private var showingRefreshTimePicker = false
    @State private var showingBufferSizePicker = false
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var authManager: AuthenticationManager
    @AppStorage("sampler_capture_invert") private var invertCaptureDuringRecording = false
    
    var body: some View {
        List {
            Section("Sampler Settings") {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Invert Capture During Recording")
                            .font(.body)
                        Text("Only affects Sampler while recording (0↔1).")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    Toggle("", isOn: $invertCaptureDuringRecording)
                }
                .padding(.vertical, 4)

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
            
            Section("Support & Information") {
                // Help Documentation
                Button(action: {
                    if let url = URL(string: "https://docs.emwaver.com") {
                        openURL(url)
                    }
                }) {
                    HStack {
                        Label("Help & Documentation", systemImage: "questionmark.circle")
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                }
                .foregroundColor(.primary)
                
                // Privacy Policy
                Button(action: {
                    if let url = URL(string: "https://emwaverpolicy.z6.web.core.windows.net/") {
                        openURL(url)
                    }
                }) {
                    HStack {
                        Label("Privacy Policy", systemImage: "hand.raised")
                        Spacer()
                        Image(systemName: "arrow.up.right.square")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                }
                .foregroundColor(.primary)
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
            .environmentObject(AuthenticationManager())
    }
}

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationView {
            SettingsView()
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }
                }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
}
