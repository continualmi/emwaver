//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptsUI

struct ContentView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager

    var body: some View {
        ScriptsRootView(device: device)
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    HStack(spacing: 8) {
                        if device.isConnected {
                            Label("Connected", systemImage: "cable.connector")
                        } else if firmwareUpdater.dfuConnected {
                            Label("Update Mode", systemImage: "arrow.triangle.2.circlepath")
                        } else {
                            Label("Disconnected", systemImage: "cable.connector.slash")
                        }

                        if device.isConnected, let v = device.deviceEmwaverVersion, !v.isEmpty {
                            Text("EMWaver \(v)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
    }
}

#Preview {
    ContentView(device: MacUSBManager(), firmwareUpdater: FirmwareUpdateManager())
}
