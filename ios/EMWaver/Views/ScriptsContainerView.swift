/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Combine
import SwiftUI
import EMWaverScriptsUI
import EMWaverScriptRuntime
import EMWaverScriptSwiftUI
import EMWaverScriptModel

protocol IOSTargetedScriptDeviceBase: AnyObject {
    func currentScriptDeviceId() -> String
    func getBuffer(deviceId: String) -> Data
    func clearBuffer(deviceId: String)
    func loadBuffer(data: Data, deviceId: String)
    func sendPacket(_ data: Data, deviceId: String)
    func sendCommand(_ command: Data, timeout: Int, deviceId: String) -> Data?
    func transmitBuffer(deviceId: String)
}

extension USBManager: IOSTargetedScriptDeviceBase {}

@MainActor
final class IOSTargetedScriptDevice: @preconcurrency ScriptDevice {
    private weak var base: IOSTargetedScriptDeviceBase?
    private let deviceId: String

    init(base: IOSTargetedScriptDeviceBase, deviceId: String) {
        self.base = base
        self.deviceId = Self.normalizeDeviceId(deviceId)
    }

    func getBuffer() -> Data { base?.getBuffer(deviceId: deviceId) ?? Data() }
    func clearBuffer() { base?.clearBuffer(deviceId: deviceId) }
    func loadBuffer(data: Data) { base?.loadBuffer(data: data, deviceId: deviceId) }
    func sendPacket(_ data: Data) { base?.sendPacket(data, deviceId: deviceId) }
    func sendCommand(_ command: Data, timeout: Int) -> Data? { base?.sendCommand(command, timeout: timeout, deviceId: deviceId) }
    func transmitBuffer() { base?.transmitBuffer(deviceId: deviceId) }

    private static func normalizeDeviceId(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "active" : trimmed
    }
}

@MainActor
final class IOSScriptSessionManager: ObservableObject {
    @Published private(set) var sessionStatuses: [ScriptsRootView.ScriptSessionStatus] = []

    private var selectedSessionId: String?
    private var sessionsById: [String: IOSScriptSession] = [:]

    var activePreviewManager: ScriptPreviewManager? {
        guard let selectedSessionId else { return nil }
        return sessionsById[selectedSessionId]?.manager
    }

    var hasRunningSessions: Bool {
        !sessionsById.isEmpty
    }

    var activeScriptName: String? {
        guard let selectedSessionId, let session = sessionsById[selectedSessionId] else {
            return sessionsById.values.first?.scriptName
        }
        return session.manager.activeScriptName ?? session.scriptName
    }

    func run(_ request: ScriptsRootView.ScriptRunRequest, device: IOSTargetedScriptDeviceBase, deviceLabel: String) -> ScriptsRootView.ScriptRunResult? {
        let manager = ScriptPreviewManager()
        let deviceId = Self.normalizeDeviceId(device.currentScriptDeviceId())
        manager.attach(device: IOSTargetedScriptDevice(base: device, deviceId: deviceId))

        let session = IOSScriptSession(
            manager: manager,
            deviceId: deviceId,
            scriptId: request.scriptId,
            scriptName: request.name,
            deviceLabel: deviceLabel.isEmpty ? "active device" : deviceLabel
        )
        session.cancellable = manager.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshStatuses()
            }

        manager.render(script: request.source, name: request.name, moduleSources: request.moduleSources)
        guard let instanceId = manager.activeScriptInstanceId else { return nil }

        sessionsById[instanceId] = session
        selectedSessionId = instanceId
        refreshStatuses()

        return ScriptsRootView.ScriptRunResult(scriptInstanceId: instanceId, name: request.name, running: true)
    }

    func selectSession(_ id: String) {
        guard sessionsById[id] != nil else { return }
        selectedSessionId = id
        refreshStatuses()
    }

    func stopSession(_ id: String) {
        guard let session = sessionsById[id] else { return }
        session.stop()
        sessionsById.removeValue(forKey: id)
        if selectedSessionId == id {
            selectedSessionId = sessionsById.keys.sorted().first
        }
        refreshStatuses()
    }

    func stopActiveSession() {
        guard let selectedSessionId else { return }
        stopSession(selectedSessionId)
    }

    func sessionDeviceId(_ id: String) -> String? {
        sessionsById[id]?.deviceId
    }

    private func refreshStatuses() {
        sessionStatuses = sessionsById
            .map { id, session in
                ScriptsRootView.ScriptSessionStatus(
                    id: id,
                    deviceId: session.deviceId,
                    scriptId: session.scriptId,
                    deviceLabel: session.deviceLabel,
                    stateText: session.manager.activeScriptName == nil ? "stopped" : "running"
                )
            }
            .sorted(
                by: {
                    let lhs = sessionsById[$0.id]?.scriptName ?? ""
                    let rhs = sessionsById[$1.id]?.scriptName ?? ""
                    return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
                }
            )
    }

    private static func normalizeDeviceId(_ deviceId: String) -> String {
        let trimmed = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "active" : trimmed
    }
}

@MainActor
private final class IOSScriptSession {
    let manager: ScriptPreviewManager
    let deviceId: String
    let scriptId: String
    let scriptName: String
    let deviceLabel: String
    var cancellable: AnyCancellable?

    init(manager: ScriptPreviewManager, deviceId: String, scriptId: String, scriptName: String, deviceLabel: String) {
        self.manager = manager
        self.deviceId = deviceId
        self.scriptId = scriptId
        self.scriptName = scriptName
        self.deviceLabel = deviceLabel
    }

    func stop() {
        manager.exitPreview()
    }
}

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var hostSessions: HostSessionManager
    @StateObject private var scriptSessions = IOSScriptSessionManager()
    @State private var isFirmwareSheetPresented = false

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
                    hostSessions.setScriptStatus(
                        running: scriptSessions.hasRunningSessions,
                        activeScriptName: scriptSessions.activeScriptName
                    )
                },
                externalScriptSessions: scriptSessions.sessionStatuses,
                onSelectExternalScriptSession: { id in
                    scriptSessions.selectSession(id)
                },
                onStopExternalScriptSession: { id in
                    scriptSessions.stopSession(id)
                    hostSessions.setScriptStatus(
                        running: scriptSessions.hasRunningSessions,
                        activeScriptName: scriptSessions.activeScriptName
                    )
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
                                Text("Target: \(port)")
                                    .foregroundStyle(.secondary)
                            } else {
                                Divider()
                                Text("Target: \(selectedDeviceLabel)")
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
                                Text(selectedDeviceLabel)
                                    .font(.caption)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: 140, alignment: .leading)
                            }
                            .contentShape(Rectangle())
                            .accessibilityLabel("\(connectionStatusText), target \(selectedDeviceLabel)")
                        }
                    }

                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        Button {
                            isFirmwareSheetPresented = true
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                        .accessibilityLabel("Firmware")

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
        .sheet(isPresented: $isFirmwareSheetPresented) {
            FirmwareUpdateSheet(device: bleManager, targetLabel: selectedDeviceLabel)
                .presentationDetents([.medium, .large])
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
