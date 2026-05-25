/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

struct FirmwareUpdateSheet: View {
    @ObservedObject var device: USBManager
    let targetLabel: String

    @Environment(\.dismiss) private var dismiss
    @State private var requestedUpdateMode = false

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    LabeledContent("Target", value: targetLabel)
                    LabeledContent("Connection", value: device.isConnected ? "Connected" : "Disconnected")
                    LabeledContent("Bundled STM32 firmware", value: bundledAssetStatus("emwaver", extension: "bin", subdirectory: "firmware"))
                    LabeledContent("Bundled ESP image", value: bundledAssetStatus("emwaver-esp32s3-app", extension: "bin", subdirectory: "firmware"))
                }

                Section("Firmware Handoff") {
                    if let stm32URL = bundledAssetURL("emwaver", extension: "bin", subdirectory: "firmware") {
                        ShareLink(item: stm32URL) {
                            Label("Share STM32 firmware", systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Label("STM32 firmware missing", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }

                    if let espURL = bundledAssetURL("emwaver-esp32s3-app", extension: "bin", subdirectory: "firmware") {
                        ShareLink(item: espURL) {
                            Label("Share ESP firmware", systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Label("ESP firmware missing", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                }

                Section("STM32 Update Mode") {
                    Text("This switches a connected STM32 board into ROM Update Mode. The board will be unusable until firmware is flashed.")
                        .foregroundStyle(.secondary)

                    Button("Enter Update Mode") {
                        device.requestEnterUpdateMode()
                        requestedUpdateMode = true
                    }
                    .disabled(!device.isConnected)

                    if requestedUpdateMode {
                        Text("Update Mode requested. Reconnect the board to a platform with STM32 DFU flashing support to write the firmware.")
                            .foregroundStyle(.orange)
                    }
                }

                Section("Flashing") {
                    Label("iOS does not expose the full STM32 DFU or ESP serial flashing runtime. Use macOS, Windows, or Android for the actual flash step.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
            .navigationTitle("Firmware")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func bundledAssetStatus(_ name: String, extension ext: String, subdirectory: String) -> String {
        bundledAssetURL(name, extension: ext, subdirectory: subdirectory) == nil ? "Missing" : "Bundled"
    }

    private func bundledAssetURL(_ name: String, extension ext: String, subdirectory: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: ext, subdirectory: subdirectory)
    }
}

#Preview {
    FirmwareUpdateSheet(device: USBManager(), targetLabel: "active device")
}
