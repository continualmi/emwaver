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

    @State private var commandInput = ""
    @FocusState private var isCommandFieldFocused: Bool

    @State private var firmwareVersion = "Unknown"

    @State private var showTxHex = false
    @State private var showRxHex = false
    @State private var showingSettingsSheet = false

    private static let maxMonitorEntries = 1500

    private static let monitorBackground = Color(red: 2/255, green: 6/255, blue: 23/255) // slate-950
    private static let monitorBorder = Color.white.opacity(0.10)
    private static let monitorTextPrimary = Color.white
    private static let monitorTextSecondary = Color.white.opacity(0.70)
    private static let txColor = Color.white
    private static let rxColor = Color(red: 59/255, green: 130/255, blue: 246/255) // blue-500

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                connectionRow
                commandRow
                bufferMonitor
                fragmentsGrid
            }
            .padding(.vertical, 16)
        }
        .background(Color(.systemBackground))
        .navigationTitle("EMWaver")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Settings") { showingSettingsSheet = true }
                    Button("Clear Buffer", role: .destructive) { clearMonitorAndBuffer() }
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
                requestFirmwareVersionSoon()
            }
        }
        .onChange(of: bleManager.bufferVersion) { _ in
            updateFirmwareVersionFromBufferIfNeeded()
        }
    }

    private var connectionRow: some View {
        HStack(spacing: 12) {
            Panel {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Circle()
                            .fill(connectionStatusColor)
                            .frame(width: 10, height: 10)
                        Text(connectionStatusText)
                            .font(.subheadline)
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
                        HStack {
                            Image(systemName: bleManager.isConnected ? "cable.connector.slash" : "cable.connector")
                            Text(bleManager.isConnected ? "Disconnect" : "Connect USB MIDI")
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .center)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(bleManager.isConnected ? .red : .blue)
                }
            }

            Panel {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Firmware")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 8) {
                        Text(firmwareVersion)
                            .font(.headline)
                            .foregroundColor(firmwareVersion == "Unknown" ? .secondary : .blue)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)

                        Spacer()

                        Button {
                            requestFirmwareVersion()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .foregroundColor(.blue)
                        .disabled(!bleManager.isConnected)
                    }
                }
            }
        }
        .padding(.horizontal)
    }

    private var fragmentsGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: 12),
            GridItem(.flexible(), spacing: 12),
        ]

        return LazyVGrid(columns: columns, spacing: 12) {
            FragmentCard(
                title: "Wavelets",
                subtitle: "Manage and run wavelets",
                systemImage: "puzzlepiece.extension",
                tint: .cyan
            ) { selection = "Wavelets" }

            FragmentCard(
                title: "ISM (RFM69)",
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
                subtitle: "Sync wavelets with GitHub",
                systemImage: "arrow.triangle.branch",
                tint: .secondary
            ) { selection = "Git" }
        }
        .padding(.horizontal)
    }

    private var commandRow: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Command")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                HStack(spacing: 8) {
                    TextField("e.g. version", text: $commandInput)
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .focused($isCommandFieldFocused)
                        .onSubmit { sendCommandFromInput() }

                    Button("Send") { sendCommandFromInput() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!bleManager.isConnected || commandInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(.horizontal)
    }

    private var bufferMonitor: some View {
        let _ = bleManager.bufferVersion
        let entries = bleManager.bufferMonitorEntries(limit: Self.maxMonitorEntries)

        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Buffer Monitor")
                        .font(.headline)
                        .foregroundColor(Self.monitorTextPrimary)
                    Spacer()
                    Button("Clear") { clearMonitorAndBuffer() }
                        .foregroundColor(.red)
                }

                HStack(spacing: 12) {
                    Toggle("TX HEX", isOn: $showTxHex)
                    Toggle("RX HEX", isOn: $showRxHex)
                }
                .font(.subheadline)
                .foregroundColor(Self.monitorTextSecondary)
                .tint(.blue)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if entries.isEmpty {
                            Text("No buffer entries yet.")
                                .foregroundColor(Self.monitorTextSecondary)
                                .font(.subheadline)
                                .padding(.vertical, 8)
                        } else {
                            ForEach(entries) { entry in
                                let timeStr = Self.formatTimestampMs(entry.ts_ms)
                                let content = entry.isTx
                                    ? (showTxHex ? Self.hexString(entry.data) : Self.asciiString(entry.data))
                                    : (showRxHex ? Self.hexString(entry.data) : Self.asciiString(entry.data))
                                Text("[\(timeStr)] \(entry.isTx ? "TX" : "RX"): \(content)")
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(entry.isTx ? Self.txColor : Self.rxColor)
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    .padding(.vertical, 6)
                }
                .frame(minHeight: 240, maxHeight: 360)
                .background(Self.monitorBackground.opacity(0.65), in: RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Self.monitorBorder.opacity(0.8), lineWidth: 1)
                )
            }
        }
        .padding(12)
        .background(Self.monitorBackground, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Self.monitorBorder, lineWidth: 1)
        )
        .padding(.horizontal)
    }

    private var connectionStatusText: String {
        if bleManager.isScanning { return "Scanning…" }
        if bleManager.isConnected {
            if let name = bleManager.connectedPortName, !name.isEmpty {
                return "Connected: \(name)"
            }
            return "Connected"
        }
        return "Not connected"
    }

    private var connectionStatusColor: Color {
        if bleManager.isScanning { return .orange }
        if bleManager.isConnected { return .green }
        return .red
    }

    private func requestFirmwareVersionSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            requestFirmwareVersion()
        }
    }

    private func requestFirmwareVersion() {
        guard bleManager.isConnected else { return }
        bleManager.sendPacket(USBManager.frameAsciiCommand("version"))
    }

    private func sendCommandFromInput() {
        let trimmed = commandInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard bleManager.isConnected else { return }

        bleManager.sendPacket(USBManager.frameAsciiCommand(trimmed))
        commandInput = ""
    }

    private func clearMonitorAndBuffer() {
        bleManager.bufferClear()
    }

    private static func formatTimestampMs(_ tsMs: UInt64) -> String {
        let date = Date(timeIntervalSince1970: Double(tsMs) / 1000.0)
        return timestampFormatter.string(from: date)
    }

    private func updateFirmwareVersionFromBufferIfNeeded() {
        guard firmwareVersion == "Unknown" else { return }
        let entries = bleManager.bufferMonitorEntries(limit: 64)
        for entry in entries.reversed() where !entry.isTx {
            if let v = Self.extractFirmwareVersion(from: entry.data) {
                firmwareVersion = v
                return
            }
        }
    }

    private static func extractFirmwareVersion(from bytes: [UInt8]) -> String? {
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

    private static func hexString(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02X", $0) }.joined(separator: " ")
    }

    private static func asciiString(_ bytes: [UInt8]) -> String {
        bytes.map { byte in
            (32...126).contains(Int(byte)) ? String(UnicodeScalar(byte)) : "."
        }.joined()
    }

    private static let timestampFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = .current
        df.dateFormat = "HH:mm:ss.SSS"
        return df
    }()
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
