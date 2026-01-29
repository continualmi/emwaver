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
    @StateObject private var firmwareUpdater = FirmwareUpdateManager()

    var body: some Scene {
        WindowGroup {
            ContentView(device: device, firmwareUpdater: firmwareUpdater)
                .sheet(isPresented: $firmwareUpdater.isPresented) {
                    FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
                }
        }
        .commands {
            CommandMenu("Device") {
                if device.isConnected {
                    Text("Status: Connected")
                        .foregroundStyle(.secondary)
                } else if firmwareUpdater.dfuConnected {
                    Text("Status: Update Mode")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Status: Disconnected")
                        .foregroundStyle(.secondary)
                }

                Divider()

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

                Button("Update Firmware…") {
                    firmwareUpdater.present()
                }

                Button("Refresh Update Mode") {
                    firmwareUpdater.refreshDfuPresence()
                }

                if firmwareUpdater.dfuConnected {
                    Text("Update Mode: Detected")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Update Mode: Not detected")
                        .foregroundStyle(.secondary)
                }

                Divider()

                if device.isConnected {
                    Text("Status: Connected")
                        .foregroundStyle(.secondary)
                    if let name = device.connectedPortName {
                        Text(name)
                            .foregroundStyle(.secondary)
                    }
                    if let v = device.deviceEmwaverVersion {
                        Text("EMWaver \(v)")
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
