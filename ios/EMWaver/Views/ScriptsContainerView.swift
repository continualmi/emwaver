/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI
import EMWaverScriptsUI
import EMWaverScriptRuntime
import EMWaverScriptSwiftUI
import EMWaverScriptModel

protocol IOSTargetedScriptDeviceBase: AnyObject {
    func getBuffer(deviceId: String) -> Data
    func clearBuffer(deviceId: String)
    func loadBuffer(data: Data, deviceId: String)
    func sendPacket(_ data: Data, deviceId: String)
    func sendCommand(_ command: Data, timeout: Int, deviceId: String) -> Data?
    func transmitBuffer(deviceId: String)
}

extension USBManager: IOSTargetedScriptDeviceBase {}

@MainActor
final class IOSTargetedScriptDevice: ScriptDevice {
    private weak var base: IOSTargetedScriptDeviceBase?
    private let deviceId: String

    init(base: IOSTargetedScriptDeviceBase, deviceId: String) {
        self.base = base
        self.deviceId = deviceId
    }

    func getBuffer() -> Data { base?.getBuffer(deviceId: deviceId) ?? Data() }
    func clearBuffer() { base?.clearBuffer(deviceId: deviceId) }
    func loadBuffer(data: Data) { base?.loadBuffer(data: data, deviceId: deviceId) }
    func sendPacket(_ data: Data) { base?.sendPacket(data, deviceId: deviceId) }
    func sendCommand(_ command: Data, timeout: Int) -> Data? { base?.sendCommand(command, timeout: timeout, deviceId: deviceId) }
    func transmitBuffer() { base?.transmitBuffer(deviceId: deviceId) }
}

@MainActor
private final class IOSScriptSessionManager: ObservableObject {
    @Published private(set) var sessionStatuses: [ScriptsRootView.ScriptSessionStatus] = []

    private var activeManager: ScriptPreviewManager?
    private var activeScriptId: String?
    private var activeScriptName: String?
    private var activeScriptInstanceId: String?
    private var activeDeviceLabel: String = "active device"

    var activePreviewManager: ScriptPreviewManager? {
        activeManager
    }

    func run(_ request: ScriptsRootView.ScriptRunRequest, device: USBManager, deviceLabel: String) -> ScriptsRootView.ScriptRunResult? {
        activeManager?.exitPreview()

        let manager = ScriptPreviewManager()
        let deviceId = device.currentScriptDeviceId()
        manager.attach(device: IOSTargetedScriptDevice(base: device, deviceId: deviceId))
        manager.render(script: request.source, name: request.name, moduleSources: request.moduleSources)

        let instanceId = manager.activeScriptInstanceId ?? UUID().uuidString
        activeManager = manager
        activeScriptId = request.scriptId
        activeScriptName = request.name
        activeScriptInstanceId = instanceId
        activeDeviceLabel = deviceLabel.isEmpty ? "active device" : deviceLabel
        refreshStatuses()

        return ScriptsRootView.ScriptRunResult(scriptInstanceId: instanceId, name: request.name, running: true)
    }

    func selectSession(_ id: String) {
        guard id == activeScriptInstanceId else { return }
        refreshStatuses()
    }

    func stopSession(_ id: String) {
        guard id == activeScriptInstanceId else { return }
        stopActiveSession()
    }

    func stopActiveSession() {
        activeManager?.exitPreview()
        activeManager = nil
        activeScriptId = nil
        activeScriptName = nil
        activeScriptInstanceId = nil
        refreshStatuses()
    }

    private func refreshStatuses() {
        guard let id = activeScriptInstanceId, let scriptId = activeScriptId else {
            sessionStatuses = []
            return
        }

        sessionStatuses = [
            ScriptsRootView.ScriptSessionStatus(
                id: id,
                scriptId: scriptId,
                deviceLabel: activeDeviceLabel,
                stateText: activeManager?.activeScriptName == nil ? "stopped" : "running"
            )
        ]
    }
}

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var hostSessions: HostSessionManager
    @StateObject private var scriptSessions = IOSScriptSessionManager()

    var body: some View {
        NavigationStack {
            ScriptsRootView(
                device: bleManager,
                agentEndpointProvider: {
                    auth.agentEndpointConfig
                },
                hostStatusSink: { running, name in
                    // Treat preview showing as script running on iOS.
                    hostSessions.setScriptStatus(running: running, activeScriptName: name)
                },
                agentEnabled: auth.isSignedIn,
                onRequestAgentUpgrade: {
                    auth.isSignInSheetPresented = true
                },
                onRunScript: { request in
                    let result = scriptSessions.run(request, device: bleManager, deviceLabel: selectedDeviceLabel)
                    hostSessions.setScriptStatus(running: result?.running == true, activeScriptName: result?.name)
                    return result
                },
                activePreviewManagerProvider: {
                    scriptSessions.activePreviewManager
                },
                onStopActiveScript: {
                    scriptSessions.stopActiveSession()
                    hostSessions.setScriptStatus(running: false, activeScriptName: nil)
                },
                externalScriptSessions: scriptSessions.sessionStatuses,
                onSelectExternalScriptSession: { id in
                    scriptSessions.selectSession(id)
                },
                onStopExternalScriptSession: { id in
                    scriptSessions.stopSession(id)
                    hostSessions.setScriptStatus(running: false, activeScriptName: nil)
                }
            )
            .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Menu {
                            Button("Refresh Ports") {
                                bleManager.refreshPorts()
                            }

                            if bleManager.isConnected {
                                Button("Disconnect", role: .destructive) {
                                    bleManager.disconnect()
                                }
                            } else {
                                Button(bleManager.isScanning ? "Scanning..." : "Connect") {
                                    bleManager.startScan()
                                }
                                .disabled(bleManager.isScanning)
                            }

                            if let port = bleManager.connectedPortName, !port.isEmpty {
                                Divider()
                                Text(port)
                                    .foregroundStyle(.secondary)
                            }

                            if let err = bleManager.lastErrorText, !err.isEmpty {
                                Divider()
                                Text(err)
                                    .foregroundStyle(.secondary)
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(connectionStatusColor)
                                    .frame(width: 8, height: 8)
                                Image(systemName: "cable.connector")
                            }
                            .contentShape(Rectangle())
                            .accessibilityLabel(connectionStatusText)
                        }
                    }

                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        Menu {
                            if auth.hasSavedKey {
                                Text(auth.userLabel)
                                    .foregroundStyle(.secondary)
                                Divider()
                                Button("Replace Agent Key") {
                                    auth.isSignInSheetPresented = true
                                }
                                Button("Clear Agent Key", role: .destructive) {
                                    auth.clearAgentApiKey()
                                }
                            } else {
                                Button("Agent Key") {
                                    auth.isSignInSheetPresented = true
                                }
                            }
                        } label: {
                            Image(systemName: "key.fill")
                        }

                    }
                }
        }
        .sheet(isPresented: $auth.isSignInSheetPresented) {
            SignInSheet()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var connectionStatusText: String {
        if bleManager.isScanning { return "Scanning…" }
        if bleManager.isConnected { return "Connected" }
        return "Disconnected"
    }

    private var connectionStatusColor: Color {
        if bleManager.isScanning { return .orange }
        if bleManager.isConnected { return .green }
        return .red
    }

    private var selectedDeviceLabel: String {
        if let port = bleManager.connectedPortName?.trimmingCharacters(in: .whitespacesAndNewlines), !port.isEmpty {
            return port
        }
        return bleManager.isConnected ? "Connected device" : "active device"
    }
}
