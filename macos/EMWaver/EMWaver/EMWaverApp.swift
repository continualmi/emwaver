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
    @StateObject private var auth = AuthenticationManager()
    @StateObject private var hostSessions = HostSessionManager()
    @StateObject private var hostDirectory = HostDirectory()
    @StateObject private var remoteControlHost = RemoteControlHostService()

    var body: some Scene {
        WindowGroup {
            ContentView(device: device, firmwareUpdater: firmwareUpdater, hostSessions: hostSessions, hostDirectory: hostDirectory, remoteControlHost: remoteControlHost)
                .environmentObject(auth)
                .sheet(isPresented: $firmwareUpdater.isPresented) {
                    FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
                }
                .task {
                    // Best-effort background heartbeat + host discovery.
                    hostSessions.start(auth: auth, device: device)
                    hostDirectory.start(auth: auth)

                    // Remote control host WS (web can attach + drive scripts/UI).
                    remoteControlHost.start(auth: auth, device: device, hostSessions: hostSessions)
                }
        }
        .commands {
            CommandMenu("Account") {
                if auth.isSignedIn {
                    Button("Sign Out") {
                        Task { await auth.signOut() }
                    }
                } else {
                    Button("Sign In…") {
                        auth.isSignInSheetPresented = true
                    }
                    .disabled(!auth.canSignInWithGoogle)
                }
            }

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

                if device.isConnected {
                    Button("Enter Update Mode") {
                        device.requestEnterUpdateMode()
                        device.disconnect()
                        firmwareUpdater.refreshDfuPresence()
                    }
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
