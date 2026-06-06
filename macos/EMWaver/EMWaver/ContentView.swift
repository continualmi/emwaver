//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import AppKit
import EMWaverScriptsUI
import EMWaverScriptRuntime

struct ContentView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @ObservedObject var hostSessions: HostSessionManager
    @ObservedObject var scriptSessions: MacScriptSessionManager
    @ObservedObject var appUpdater: MacAppUpdateController
    @ObservedObject var mcpServer: MacMcpServer
    @EnvironmentObject private var appRouter: AppRouter

    let previewManager: ScriptPreviewManager

    @State private var showingSettings: Bool = false
    @State private var showingMcpInfo: Bool = false
    @State private var autoFirmwarePromptKey: String? = nil

    private var toolbarDeviceStatus: (icon: String, text: String) {
        if device.isConnected {
            if device.connectedTransportKind == "BLE" {
                return ("antenna.radiowaves.left.and.right", currentBoardDisplayName)
            }
            if device.connectedTransportKind == "Wi-Fi" {
                return ("wifi", currentBoardDisplayName)
            }
            return ("cable.connector", currentBoardDisplayName)
        }
        if firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil {
            return ("cpu", "ESP Bootloader")
        }
        if firmwareUpdater.dfuConnected {
            return ("arrow.triangle.2.circlepath", "Update Mode")
        }
        if device.isBleScanning {
            return ("antenna.radiowaves.left.and.right", "Scanning")
        }
        return ("cable.connector.slash", "Disconnected")
    }

    private var currentBoardType: String {
        if firmwareUpdater.espBootloaderConnected || firmwareUpdater.espBootloaderPort != nil {
            return "esp32"
        }
        return device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private var currentBoardDisplayName: String {
        let displayName = LocalDeviceLabelFormatter.boardDisplayName(currentBoardType)
        return displayName == "Device" ? (device.connectedPortName ?? "Connected") : displayName
    }

    private var needsAutomaticFirmwareRecovery: Bool {
        false
    }

    private var autoRecoveryKey: String? {
        guard needsAutomaticFirmwareRecovery else { return nil }
        let port = device.connectedPortName ?? "unknown"
        let version = device.deviceEmwaverVersion ?? "unknown"
        return "\(currentBoardType)|\(port)|\(version)"
    }

    private var shouldPromptForDfuFlash: Bool {
        guard firmwareUpdater.dfuConnected else { return false }
        guard !firmwareUpdater.isFlashing else { return false }
        guard !firmwareUpdater.updateDone else { return false }
        guard !firmwareUpdater.espBootloaderConnected else { return false }
        guard firmwareUpdater.espBootloaderPort == nil else { return false }
        return true
    }

    private var automaticFirmwarePromptKey: String? {
        if let recoveryKey = autoRecoveryKey {
            return "recovery|\(recoveryKey)"
        }
        if shouldPromptForDfuFlash {
            let boardType = firmwareUpdater.presentedBoardType ?? currentBoardType
            return "dfu|\(boardType)"
        }
        return nil
    }

    private var scriptDeviceBridge: (any ScriptDevice)? {
        guard device.isConnected else { return nil }
        return device
    }

    private var scriptDeviceAttachmentKey: String {
        let suffix = (scriptDeviceBridge == nil) ? "disconnected" : "ready"
        return "\(currentBoardType)-\(suffix)"
    }

    private var selectedLocalDevice: LocalDeviceDescriptor? {
        guard let id = scriptSessions.selectedDeviceID else { return nil }
        return device.discoveredDevices.first(where: { $0.id == id && hardwareUID(from: $0.identifierText) != nil })
            ?? toolbarDeviceChoices.first(where: { $0.id == id })
    }

    private var selectedLocalDeviceLabel: String {
        guard let selectedLocalDevice else {
            return device.isConnected ? currentBoardDisplayName : "No Device"
        }
        return LocalDeviceLabelFormatter.label(for: selectedLocalDevice)
    }

    private var scriptsRootContent: some View {
        ScriptsRootView(
            previewManager: previewManager,
            device: scriptDeviceBridge,
            hostStatusSink: { running, name in
                // Treat "preview showing" as "script running" on macOS.
                hostSessions.setScriptStatus(running: running, activeScriptName: name)
            },
            onRequestOpenSettings: {
                showingSettings = true
            },
            leadingHeaderItem: nil,
            navigationTitleAccessoryText: nil,
            onRunScript: { request in
                scriptSessions.run(request)
            },
            activePreviewManagerProvider: {
                scriptSessions.activePreviewManager
            },
            onStopActiveScript: {
                scriptSessions.stopSelectedSession()
            },
            externalScriptSessions: scriptSessions.scriptSessionStatuses,
            onSelectExternalScriptSession: { id in
                scriptSessions.selectSession(id)
            },
            onStopExternalScriptSession: { id in
                scriptSessions.stopSession(id)
            }
        )
        .id(scriptDeviceAttachmentKey)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                scriptsRootContent
            }
            .overlay(alignment: .top) {
                Divider()
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                Button {
                    showingMcpInfo = true
                } label: {
                    Label("MCP", systemImage: "point.3.connected.trianglepath.dotted")
                }
                .help("Desktop MCP")

                localDevicePicker
            }
        }
        .sheet(isPresented: $appRouter.isDeviceSheetPresented) {
            DeviceConnectionSheet(
                device: device,
                firmwareUpdater: firmwareUpdater,
                selectedDeviceID: Binding(
                    get: { scriptSessions.selectedDeviceID },
                    set: { scriptSessions.selectDeviceID($0) }
                )
            )
        }
        .sheet(isPresented: $firmwareUpdater.isPresented) {
            FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView(device: device, appUpdater: appUpdater, mcpServer: mcpServer)
        }
        .sheet(isPresented: $showingMcpInfo) {
            MacMcpInfoView(mcpServer: mcpServer)
        }
        .task {
            scriptSessions.attach(device: device)
            firmwareUpdater.refreshDfuPresence()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                triggerAutomaticFirmwarePromptIfNeeded()
            }
        }
        .onChange(of: device.connectedBoardType) {
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.discoveredDevices) { _, devices in
            scriptSessions.updateDevices(devices)
        }
        .onChange(of: device.isConnected) { _, connected in
            if !connected && !firmwareUpdater.dfuConnected {
                autoFirmwarePromptKey = nil
            }
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.deviceEmwaverVersion) {
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: firmwareUpdater.dfuConnected) { _, connected in
            if !connected {
                autoFirmwarePromptKey = nil
            }
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: firmwareUpdater.updateDone) { _, done in
            if !done {
                triggerAutomaticFirmwarePromptIfNeeded()
            }
        }

    }

    private func triggerAutomaticFirmwarePromptIfNeeded() {
        guard let key = automaticFirmwarePromptKey else { return }
        guard autoFirmwarePromptKey != key else { return }

        autoFirmwarePromptKey = key
        firmwareUpdater.present(boardType: currentBoardType)
    }

    @ViewBuilder
    private var localDevicePicker: some View {
        Menu {
            if toolbarDeviceChoices.isEmpty {
                Text("No local devices")
                    .foregroundStyle(.secondary)
            } else {
                Picker("Local Device", selection: Binding(
                    get: { scriptSessions.selectedDeviceID },
                    set: { selectedID in
                        scriptSessions.selectDeviceID(selectedID)
                        if let selectedID,
                           let item = device.discoveredDevices.first(where: { $0.id == selectedID }),
                           item.connectionState != .connected {
                            device.connectDevice(id: selectedID)
                        }
                    }
                )) {
                    ForEach(toolbarDeviceChoices) { item in
                        Label(LocalDeviceLabelFormatter.label(for: item), systemImage: transportIcon(for: item.transport))
                            .tag(Optional(item.id))
                    }
                }
                .labelsHidden()
                .pickerStyle(.inline)
            }

            Divider()

            Button("Open Device Options...") {
                appRouter.isDeviceSheetPresented = true
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: selectedLocalDevice.map { transportIcon(for: $0.transport) } ?? toolbarDeviceStatus.icon)
                Text(selectedLocalDeviceLabel)
            }
        }
        .help("Select the local device used by the next script session")
    }

    private var toolbarDeviceChoices: [LocalDeviceDescriptor] {
        var choices: [String: LocalDeviceDescriptor] = [:]
        let selectedUID = scriptSessions.selectedDeviceID
            .flatMap { selectedID in device.discoveredDevices.first(where: { $0.id == selectedID }) }
            .flatMap { hardwareUID(from: $0.identifierText) }
        for item in device.discoveredDevices {
            guard let uid = hardwareUID(from: item.identifierText) else {
                continue
            }
            let key = "uid:\(uid)"
            if let selectedDeviceID = scriptSessions.selectedDeviceID,
               let selectedUID,
               uid == selectedUID {
                if item.id == selectedDeviceID {
                    choices[key] = item
                } else if choices[key] == nil {
                    choices[key] = item
                }
                continue
            }
            if let current = choices[key] {
                choices[key] = preferredToolbarChoice(current, item)
            } else {
                choices[key] = item
            }
        }
        return choices.values.sorted {
            if $0.isActive != $1.isActive { return $0.isActive && !$1.isActive }
            return LocalDeviceLabelFormatter.label(for: $0).localizedStandardCompare(LocalDeviceLabelFormatter.label(for: $1)) == .orderedAscending
        }
    }

    private func preferredToolbarChoice(_ lhs: LocalDeviceDescriptor, _ rhs: LocalDeviceDescriptor) -> LocalDeviceDescriptor {
        let lhsPriority = toolbarTransportPriority(lhs.transport)
        let rhsPriority = toolbarTransportPriority(rhs.transport)
        if lhsPriority != rhsPriority { return lhsPriority < rhsPriority ? lhs : rhs }
        if lhs.connectionState == .connected && rhs.connectionState != .connected { return lhs }
        if rhs.connectionState == .connected && lhs.connectionState != .connected { return rhs }
        if lhs.isActive != rhs.isActive { return lhs.isActive ? lhs : rhs }
        return lhs
    }

    private func toolbarTransportPriority(_ transport: LocalDeviceDescriptor.TransportKind) -> Int {
        switch transport {
        case .usbMidi:
            return 0
        case .ble:
            return 1
        case .wifi:
            return 2
        }
    }

    private func hardwareUID(from identifierText: String?) -> String? {
        guard let identifierText, identifierText.hasPrefix("UID ") else { return nil }
        let uid = String(identifierText.dropFirst("UID ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard uid.count == 12, uid.allSatisfy(\.isHexDigit) else { return nil }
        return uid
    }

    private func transportIcon(for transport: LocalDeviceDescriptor.TransportKind) -> String {
        switch transport {
        case .ble:
            return "antenna.radiowaves.left.and.right"
        case .usbMidi:
            return "cable.connector"
        case .wifi:
            return "wifi"
        }
    }

}

private struct MacMcpInfoView: View {
    @ObservedObject var mcpServer: MacMcpServer
    @Environment(\.dismiss) private var dismiss
    @AppStorage(MacMcpSettings.enabledKey) private var mcpServerEnabled = false
    @AppStorage(MacMcpSettings.tokenKey) private var mcpServerToken = MacMcpSettings.token

    private var statusText: String {
        if !mcpServerEnabled {
            return "Disabled"
        }
        if mcpServer.isRunning {
            return "Enabled on loopback"
        }
        if let error = mcpServer.lastErrorText, !error.isEmpty {
            return "Start failed: \(error)"
        }
        return "Starting"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Desktop MCP") {
                    Toggle("Enable local MCP server", isOn: $mcpServerEnabled)
                    LabeledContent("Status", value: statusText)
                    copyRow("Endpoint", value: mcpServer.endpointURL)
                    copyRow("Bearer token", value: mcpServerToken)
                    Button("Reset token") {
                        mcpServerToken = MacMcpSettings.resetToken()
                    }
                }

                Section("Connect") {
                    Text("Use the endpoint and bearer token in an MCP client that supports local Streamable HTTP servers.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Link("EMWaver MCP docs", destination: URL(string: "https://emwaver.ai/docs/mcp")!)
                    Link("Official MCP docs", destination: URL(string: "https://modelcontextprotocol.io/docs/getting-started/intro")!)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("MCP")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onChange(of: mcpServerEnabled) {
                mcpServer.syncWithSettings()
            }
            .frame(minWidth: 560, minHeight: 420)
        }
    }

    private func copyRow(_ title: String, value: String) -> some View {
        LabeledContent(title) {
            HStack {
                Text(value)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(value, forType: .string)
                }
            }
        }
    }
}

#Preview {
    ContentView(
        device: MacUSBManager(),
        firmwareUpdater: FirmwareUpdateManager(),
        hostSessions: HostSessionManager(),
        scriptSessions: MacScriptSessionManager(),
        appUpdater: MacAppUpdateController(),
        mcpServer: MacMcpServer(),
        previewManager: ScriptPreviewManager()
    )
    .environmentObject(AppRouter())
}
