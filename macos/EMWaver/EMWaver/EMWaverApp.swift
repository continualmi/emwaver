//
//  EMWaverApp.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI

@main
struct EMWaverApp: App {
    @StateObject private var device = MacUSBManager()

    var body: some Scene {
        WindowGroup {
            ContentView(device: device)
        }
        .commands {
            CommandMenu(device.isConnected ? "USB (Connected)" : "USB (Disconnected)") {
                Button("Refresh Ports") {
                    device.refreshPorts()
                }

                Divider()

                Toggle("Auto-connect", isOn: $device.autoConnectEnabled)

                Menu("Connect") {
                    if device.availablePorts.isEmpty {
                        Text("No ports")
                    } else {
                        ForEach(device.availablePorts, id: \.self) { port in
                            Button {
                                device.connect(portName: port)
                            } label: {
                                if port == device.connectedPortName, device.isConnected {
                                    Label(port, systemImage: "checkmark")
                                } else {
                                    Text(port)
                                }
                            }
                        }
                    }
                }

                Button("Disconnect") {
                    device.disconnect()
                }
                .disabled(!device.isConnected)

                Divider()

                if device.isConnected {
                    Text("Status: Connected")
                        .foregroundStyle(.secondary)
                    if let name = device.connectedPortName {
                        Text(name)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Status: Disconnected")
                        .foregroundStyle(.secondary)
                }

                if let err = device.lastErrorText, !err.isEmpty {
                    Divider()
                    Text(err)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
        }
    }
}
