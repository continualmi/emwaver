/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI

/// Firmware flashing is intentionally disabled on iOS for the USB-only platform.
/// Use Desktop/CLI DFU flows for STM32 devices.
struct FlashView: View {
    @EnvironmentObject var bleManager: USBManager

    var body: some View {
        VStack(spacing: 16) {
            VStack(spacing: 8) {
                Text("Firmware Flashing")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Not available on iOS in USB-only mode. Use Desktop/CLI DFU flows to flash supported devices.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text("Connection")
                    .font(.headline)

                Text(bleManager.isConnected ? "Connected: \(bleManager.connectedPortName ?? "—")" : "Not connected")
                    .foregroundStyle(bleManager.isConnected ? .green : .secondary)

                Button {
                    if bleManager.isConnected {
                        bleManager.disconnect()
                    } else {
                        bleManager.startScan()
                    }
                } label: {
                    HStack {
                        Image(systemName: bleManager.isConnected ? "cable.connector.slash" : "cable.connector")
                        Text(bleManager.isConnected ? "Disconnect" : "Connect USB")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(bleManager.isConnected ? .red : .blue)
            }

            Spacer()
        }
        .padding()
        .navigationTitle("Flash")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    NavigationView {
        FlashView()
            .environmentObject(USBManager())
    }
}
