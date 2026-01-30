/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI

#if os(iOS) || os(tvOS) || os(visionOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct EMWaverView: View {
    @EnvironmentObject var bleManager: USBManager

    @State private var shellInput = ""
    @FocusState private var isShellFocused: Bool
    @State private var shellLog: String = ""

    @State private var firmwareVersion = "Unknown"
    @State private var showingSettingsSheet = false

    private static let shellBackground = Color.black
    private static let shellText = Color(red: 0, green: 1, blue: 0) // Green

    private static var platformBackground: Color {
#if os(iOS) || os(tvOS) || os(visionOS)
        return Color(UIColor.systemBackground)
#elseif os(macOS)
        return Color(NSColor.windowBackgroundColor)
#else
        return Color.white
#endif
    }
    
    var body: some View {
        VStack(spacing: 0) {
            connectionRow
                .padding(.vertical, 8)
                .background(Self.platformBackground)
            
            Divider()
            
            shellSection
                .frame(maxHeight: .infinity)
        }
        .background(Self.platformBackground)
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

            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { isShellFocused = false }
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
                .contentShape(Rectangle())
                .onTapGesture { isShellFocused = false }
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
                    .emw_disableAutocapitalization()
                
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
        // Render the most recent buffer entries in timestamp order.
        // `bufferMonitorEntries` already returns oldest → newest.
        let entries = bleManager.bufferMonitorEntries(limit: 200)

        var newLog = ""
        for entry in entries {
            let content = asciiString(entry.data)
            guard !content.isEmpty else { continue }
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
        let trimmed = bytes.prefix { $0 != 0 }
        let text = String(decoding: trimmed, as: UTF8.self)
        return text.trimmingCharacters(in: .newlines)
    }
}

private struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    private static var panelBackground: Color {
#if os(iOS) || os(tvOS) || os(visionOS)
        return Color(UIColor.systemBackground)
#elseif os(macOS)
        return Color(NSColor.windowBackgroundColor)
#else
        return Color.white
#endif
    }

    var body: some View {
        content
            .padding(12)
            .background(Self.panelBackground, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.black.opacity(0.08), lineWidth: 1)
            )
    }
}

private extension View {
    @ViewBuilder
    func emw_disableAutocapitalization() -> some View {
#if os(iOS) || os(tvOS) || os(visionOS)
        if #available(iOS 15.0, tvOS 15.0, *) {
            self.textInputAutocapitalization(.never)
        } else {
            self.autocapitalization(.none)
        }
#else
        self
#endif
    }
}

#Preview {
    NavigationView {
        EMWaverView()
            .environmentObject(USBManager())
    }
}
