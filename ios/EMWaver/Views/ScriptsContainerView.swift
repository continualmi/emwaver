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
    func beginTransportSession(deviceId: String) -> Bool
    func endTransportSession(deviceId: String)
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
        let deviceId = Self.normalizeDeviceId(device.currentScriptDeviceId())
        print("[SCRIPT] run: name=\(request.name) deviceId=\(deviceId)")

        guard device.beginTransportSession(deviceId: deviceId) else {
            print("[SCRIPT] run: transport claim FAILED")
            return ScriptsRootView.ScriptRunResult(
                scriptInstanceId: "",
                name: request.name,
                running: false,
                errorMessage: "Cannot run script: transport claim failed"
            )
        }
        print("[SCRIPT] run: transport session claimed, starting script engine")

        let manager = ScriptPreviewManager()
        let deviceBridge = IOSTargetedScriptDevice(base: device, deviceId: deviceId)
        manager.attach(device: deviceBridge)

        let session = IOSScriptSession(
            manager: manager,
            deviceBridge: deviceBridge,
            deviceId: deviceId,
            scriptId: request.scriptId,
            scriptName: request.name,
            deviceLabel: deviceLabel.isEmpty ? "active device" : deviceLabel
        )
        session.deviceBase = device
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
    let deviceBridge: IOSTargetedScriptDevice
    let deviceId: String
    let scriptId: String
    let scriptName: String
    let deviceLabel: String
    weak var deviceBase: IOSTargetedScriptDeviceBase?
    var cancellable: AnyCancellable?

    init(manager: ScriptPreviewManager, deviceBridge: IOSTargetedScriptDevice, deviceId: String, scriptId: String, scriptName: String, deviceLabel: String) {
        self.manager = manager
        self.deviceBridge = deviceBridge
        self.deviceId = deviceId
        self.scriptId = scriptId
        self.scriptName = scriptName
        self.deviceLabel = deviceLabel
    }

    func stop() {
        print("[SCRIPT] stop: name=\(scriptName) deviceId=\(deviceId)")
        deviceBase?.endTransportSession(deviceId: deviceId)
        manager.exitPreview()
    }
}

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var hostSessions: HostSessionManager
    @StateObject private var scriptSessions = IOSScriptSessionManager()
    @State private var isWiFiConnectPresented = false
    @State private var isWiFiSetupPresented = false
    @State private var wifiHost = ""
    @State private var wifiPort = String(WiFiTransport.defaultPort)
    @State private var wifiSSID = ""
    @State private var wifiPassword = ""
    private let previewDevice = try? SimulatorScriptDevice.basicBoard()

    var body: some View {
        NavigationStack {
            ScriptsRootView(
                device: scriptDevice,
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
                navigationTitleAccessoryText: IOSAppBuildInfo.toolbarVersionText,
                onRunScript: runScriptHandler,
                activePreviewManagerProvider: activePreviewManagerProvider,
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

                                Button("Connect Wi-Fi") {
                                    isWiFiConnectPresented = true
                                }
                            }

                            Button("Wi-Fi Setup") {
                                isWiFiSetupPresented = true
                            }
                            .disabled(!bleManager.isConnected)

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
                                Image(systemName: bleManager.activeTransportSystemImage)
                                    .imageScale(.large)
                            }
                            .contentShape(Rectangle())
                            .accessibilityLabel("\(connectionStatusText), target \(selectedDeviceLabel)")
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
        .sheet(isPresented: $isWiFiSetupPresented) {
            NavigationStack {
                Form {
                    Section {
                        TextField("SSID", text: $wifiSSID)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("Wi-Fi password", text: $wifiPassword)
                    }

                    Section {
                        Button(bleManager.isWiFiProvisioning ? "Provisioning" : "Send Wi-Fi Setup") {
                            bleManager.provisionWiFi(ssid: wifiSSID, password: wifiPassword)
                        }
                        .disabled(bleManager.isWiFiProvisioning || wifiSSID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        Button("Clear Setup", role: .destructive) {
                            bleManager.clearWiFiProvisioning()
                        }
                        .disabled(bleManager.isWiFiProvisioning)

                        Button("Status") {
                            bleManager.refreshWiFiProvisioningStatus()
                        }
                        .disabled(bleManager.isWiFiProvisioning)
                    }

                    if let status = bleManager.wifiProvisioningStatus, !status.isEmpty {
                        Section {
                            Text(status)
                                .foregroundStyle(bleManager.isWiFiProvisioningError ? .orange : .secondary)
                        }
                    }
                }
                .navigationTitle("ESP32 Wi-Fi Setup")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") {
                            isWiFiSetupPresented = false
                        }
                    }
                }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isWiFiConnectPresented) {
            NavigationStack {
                Form {
                    Section {
                        TextField("Host or IP", text: $wifiHost)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Port", text: $wifiPort)
                            .keyboardType(.numberPad)
                        Button("Connect Wi-Fi") {
                            connectManualWiFi()
                            isWiFiConnectPresented = false
                        }
                        .disabled(wifiHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    Section {
                        Button(bleManager.isWiFiDiscovering ? "Searching..." : "Search") {
                            bleManager.startWiFiDiscovery()
                        }
                        .disabled(bleManager.isWiFiDiscovering)
                        if bleManager.isWiFiDiscovering {
                            Button("Stop Search") {
                                bleManager.stopWiFiDiscovery()
                            }
                        }
                    }

                    if !bleManager.wifiDiscoveredDevices.isEmpty {
                        Section {
                            ForEach(bleManager.wifiDiscoveredDevices) { device in
                                Button {
                                    wifiHost = device.host
                                    wifiPort = String(device.port)
                                    bleManager.connectWiFi(host: device.host, port: device.port)
                                    isWiFiConnectPresented = false
                                } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(device.displayName)
                                        Text(device.host)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Connect Wi-Fi")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") {
                            isWiFiConnectPresented = false
                        }
                    }
                }
            }
            .onAppear {
                bleManager.startWiFiDiscovery()
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    private var scriptDevice: (any ScriptDevice)? {
        bleManager.isConnected ? bleManager : previewDevice
    }

    private var runScriptHandler: ((ScriptsRootView.ScriptRunRequest) async -> ScriptsRootView.ScriptRunResult?)? {
        guard bleManager.isConnected else { return nil }
        return { request in
            let result = scriptSessions.run(request, device: bleManager, deviceLabel: selectedDeviceLabel)
            hostSessions.setScriptStatus(running: result?.running == true, activeScriptName: result?.name)
            return result
        }
    }

    private var activePreviewManagerProvider: (() -> ScriptPreviewManager?)? {
        guard bleManager.isConnected else { return nil }
        return { scriptSessions.activePreviewManager }
    }

    private func connectManualWiFi() {
        let parsedPort = Int(wifiPort.trimmingCharacters(in: .whitespacesAndNewlines))
        let port: Int
        if let parsedPort, WiFiTransport.isValidPort(parsedPort) {
            port = parsedPort
        } else {
            port = WiFiTransport.defaultPort
        }
        bleManager.connectWiFi(host: wifiHost, port: port)
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
