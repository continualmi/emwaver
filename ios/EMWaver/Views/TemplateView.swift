//
//  TemplateView.swift
//  EMWaver
//
//  Developer playground for testing EMWaver APIs (transport, commands, notifications).
//

import SwiftUI

struct TemplateView: View {
    @EnvironmentObject var bleManager: BLEManager

    @State private var output: String = ""
    @State private var isBusy: Bool = false
    @State private var showHex: Bool = false

    var body: some View {
        List {
            Section("About") {
                Text("This screen is intentionally simple. It’s a starting point for hackers building EMWaver from source—edit it freely to experiment with new APIs and UI.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Where to customize")
                        .font(.footnote.weight(.semibold))
                    Text("Desktop: app/src/components/TemplateFragment.tsx")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Text("Android: android/app/src/main/java/.../ui/template/TemplateFragment.java")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Text("iOS: ios/EMWaver/Views/TemplateView.swift")
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }

            Section("Connection") {
                HStack {
                    Text(bleManager.isConnected ? "Connected" : (bleManager.isScanning ? "Scanning…" : "Not connected"))
                        .foregroundStyle(bleManager.isConnected ? .green : (bleManager.isScanning ? .yellow : .secondary))
                    Spacer()
                    if let peripheral = bleManager.connectedPeripheral {
                        Text(peripheral.name ?? peripheral.identifier.uuidString)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Text("Connect/disconnect in the EMWaver tab. This Template view only runs a simple example once connected.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Example") {
                Toggle("Hex view", isOn: $showHex)

                HStack {
                    Button("Example: version") { runCommand("version") }
                        .disabled(!bleManager.isConnected || isBusy)

                    Button("Clear") {
                        output = ""
                    }
                }
            }

            Section("Output") {
                Text(output.isEmpty ? "—" : output)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
            }
        }
        .navigationTitle("Template")
    }

    private func runCommand(_ command: String) {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        guard bleManager.isConnected else {
            output = "Not connected."
            return
        }

        isBusy = true
        output = ""

        DispatchQueue.global(qos: .userInitiated).async {
            var framed = trimmed
            if !framed.hasSuffix("\n") {
                framed += "\n"
            }

            let response = self.bleManager.sendCommand(Data(framed.utf8), timeout: 2500)
            let rendered: String
            if let response = response, !response.isEmpty {
                rendered = self.showHex ? response.map { String(format: "%02X", $0) }.joined(separator: " ") : String(decoding: response, as: UTF8.self)
            } else {
                rendered = "(timeout)"
            }

            DispatchQueue.main.async {
                self.output = rendered.trimmingCharacters(in: .whitespacesAndNewlines)
                self.isBusy = false
            }
        }
    }
}

#Preview {
    NavigationView {
        TemplateView()
            .environmentObject(BLEManager())
    }
}
