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

struct EMWaverView: View {
    @EnvironmentObject var bleManager: USBManager
    @Binding var selection: String

    @State private var shellInput = ""
    @FocusState private var isShellFocused: Bool
    @State private var shellLog: String = ""
    
    // To track what we've already seen in the buffer
    @State private var lastBufferSeq: UInt64 = 0

    @State private var firmwareVersion = "Unknown"
    @State private var showingSettingsSheet = false

    private static let shellBackground = Color.black
    private static let shellText = Color(red: 0, green: 1, blue: 0) // Green
    
    var body: some View {
        VStack(spacing: 0) {
            connectionRow
                .padding(.vertical, 8)
                .background(Color(.systemBackground))
            
            Divider()
            
            shellSection
            
            Divider()
            
            ScrollView {
                fragmentsGrid
                    .padding(.vertical, 16)
            }
            .frame(height: 120) // Fixed height for fragments at bottom
            .background(Color(.secondarySystemBackground))
        }
        .background(Color(.systemBackground))
        .navigationTitle("EMWaver")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Settings") { showingSettingsSheet = true }
                    Button("Clear Shell", role: .destructive) { 
                        shellLog = "" 
                        bleManager.bufferClear()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingSettingsSheet) {
            SettingsSheet()
        }
        .onChange(of: bleManager.isConnected) { connected in
            if !connected {
                firmwareVersion = "Unknown"
            } else {
                // Wait a bit for connection to stabilize
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    requestFirmwareVersion()
                }
            }
        }
        .onChange(of: bleManager.bufferVersion) { _ in
            updateShell()
            updateFirmwareVersionFromBufferIfNeeded()
        }
    }

    private var connectionRow: some View {
        HStack(spacing: 12) {
            Panel {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Circle()
                            .fill(connectionStatusColor)
                            .frame(width: 8, height: 8)
                        Text(connectionStatusText)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Spacer()
                    }

                    Button {
                        if bleManager.isConnected {
                            bleManager.disconnect()
                        } else {
                            bleManager.startScan()
                        }
                    } label: {
                        Text(bleManager.isConnected ? "Disconnect" : "Connect")
                            .font(.caption).bold()
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(bleManager.isConnected ? .red : .blue)
                    .controlSize(.small)
                }
            }
            .frame(maxWidth: .infinity)

            Panel {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Firmware")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack {
                        Text(firmwareVersion)
                            .font(.callout).bold()
                            .foregroundColor(firmwareVersion == "Unknown" ? .secondary : .blue)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        
                        Spacer()
                        
                        Button {
                            requestFirmwareVersion()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.caption)
                        }
                        .disabled(!bleManager.isConnected)
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal)
    }

    private var shellSection: some View {
        VStack(spacing: 0) {
            // Shell Output
            ScrollViewReader { proxy in
                ScrollView {
                    Text(shellLog)
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(Self.shellText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .id("bottom")
                }
                .background(Self.shellBackground)
                .onChange(of: shellLog) { _ in
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            
            // Shell Input
            HStack(spacing: 0) {
                Text("emw> ")
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(Self.shellText)
                    .padding(.leading, 8)
                
                TextField("", text: $shellInput)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(Self.shellText)
                    .accentColor(Self.shellText)
                    .submitLabel(.send)
                    .onSubmit { sendCommand() }
                    .focused($isShellFocused)
                    .disableAutocorrection(true)
                    .autocapitalization(.none)
                
                Button {
                    sendCommand()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundColor(Self.shellText)
                }
                .padding(.horizontal, 8)
                .disabled(shellInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !bleManager.isConnected)
            }
            .padding(.vertical, 8)
            .background(Self.shellBackground)
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(.white.opacity(0.2)),
                alignment: .top
            )
        }
    }

    private var fragmentsGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: 12),
            GridItem(.flexible(), spacing: 12),
        ]

        return LazyVGrid(columns: columns, spacing: 12) {
            FragmentCard(
                title: "Scripts",
                subtitle: "Manage and run scripts",
                systemImage: "puzzlepiece.extension",
                tint: .cyan
            ) { selection = "Scripts" }

            FragmentCard(
                title: "ISM",
                subtitle: "Sub‑GHz radio control",
                systemImage: "dot.radiowaves.left.and.right",
                tint: .green
            ) { selection = "ISM" }

            FragmentCard(
                title: "Sampler",
                subtitle: "Signal sampling and analysis",
                systemImage: "waveform.path.ecg",
                tint: .purple
            ) { selection = "Sampler" }

            FragmentCard(
                title: "Git",
                subtitle: "Sync scripts with GitHub",
                systemImage: "arrow.triangle.branch",
                tint: .secondary
            ) { selection = "Git" }
        }
        .padding(.horizontal)
    }

    private var connectionStatusText: String {
        if bleManager.isScanning { return "Scanning..." }
        if bleManager.isConnected { return "Connected" }
        return "Not connected"
    }

    private var connectionStatusColor: Color {
        if bleManager.isScanning { return .orange }
        if bleManager.isConnected { return .green }
        return .red
    }

    private func requestFirmwareVersion() {
        guard bleManager.isConnected else { return }
        bleManager.sendPacket(USBManager.frameAsciiCommand("version"))
    }

    private func sendCommand() {
        let trimmed = shellInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard bleManager.isConnected else { return }

        // The shell logic in updateShell will handle displaying the echo
        // if we rely on what's actually sent, OR we can append here locally.
        // Android implementation appended "emw> command" locally.
        // But since we are streaming from buffer, let's see if TX is in buffer.
        // Yes, USBManager puts TX in buffer.
        
        bleManager.sendPacket(USBManager.frameAsciiCommand(trimmed))
        shellInput = ""
    }

    private func updateShell() {
        // Poll new entries from bleManager since lastBufferSeq
        // We need a way to get *new* entries from USBManager, or just get last N and filter.
        // USBManager doesn't expose sequence numbers on entries directly in the View struct I saw earlier,
        // but let's assume `bufferMonitorEntries` returns sorted entries.
        // A better way is to keep track of the last processed timestamp or sequence.
        
        // Since `bufferMonitorEntries` returns a fresh array, let's just grab the latest ones
        // that have a seq > lastBufferSeq.
        // Note: The `PacketEntry` in `USBManager` (Swift) needs to expose `seq`.
        // If it doesn't, we might need to rely on `ts_ms` or index.
        
        // Let's re-read USBManager.swift to see PacketEntry definition if needed.
        // Assuming it matches what was there before or I can adapt.
        
        // Actually, the previous code used: `bleManager.bufferMonitorEntries(limit: Self.maxMonitorEntries)`
        // `PacketEntry` had `seq` in Android, let's check Swift.
        
        // For now, I'll assume we can get all and filter locally, or just show the last N lines.
        // But to be "shell-like", we want a continuous stream.
        
        let entries = bleManager.bufferMonitorEntries(limit: 50) // Get last 50
        // We only append new ones.
        // Simple logic: maintain a set of seen IDs or just rebuild the string if it's not too long?
        // Rebuilding is safer for sync.
        
        var newLog = ""
        for entry in entries.reversed() { // old to new
             let content = asciiString(entry.data)
             if entry.isTx {
                 newLog += "emw> \(content)\n"
             } else {
                 newLog += "\(content)\n"
             }
        }
        shellLog = newLog
    }

    private func updateFirmwareVersionFromBufferIfNeeded() {
        guard firmwareVersion == "Unknown" else { return }
        let entries = bleManager.bufferMonitorEntries(limit: 64)
        for entry in entries { // Check recent entries
            if !entry.isTx, let v = extractFirmwareVersion(from: entry.data) {
                firmwareVersion = v
                return
            }
        }
    }

    private func extractFirmwareVersion(from bytes: [UInt8]) -> String? {
        guard !bytes.isEmpty else { return nil }
        let trimmed = bytes.prefix { $0 != 0 }
        let text = String(decoding: trimmed, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }

        if let match = text.range(of: #"\b\d+\.\d+\.\d+\b"#, options: .regularExpression) {
            return String(text[match])
        }
        if text.contains("Welcome to"), let dash = text.firstIndex(of: "-") {
            let versionPart = text[..<dash].trimmingCharacters(in: .whitespacesAndNewlines)
            if !versionPart.isEmpty {
                return String(versionPart)
            }
        }
        return nil
    }

    private func asciiString(_ bytes: [UInt8]) -> String {
        bytes.map { byte in
            (32...126).contains(Int(byte)) ? String(UnicodeScalar(byte)) : "."
        }.joined()
    }
}

private struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(12)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
            )
    }
}

private struct FragmentCard: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: systemImage)
                        .foregroundColor(tint)
                    Spacer()
                }
                Text(title)
                    .font(.headline)
                    .foregroundColor(isEnabled ? .primary : .secondary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .padding(12)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(isEnabled ? tint.opacity(0.18) : Color.gray.opacity(0.12), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1.0 : 0.55)
    }
}

#Preview {
    NavigationView {
        EMWaverView(selection: .constant("EMWaver"))
            .environmentObject(USBManager())
    }
}
