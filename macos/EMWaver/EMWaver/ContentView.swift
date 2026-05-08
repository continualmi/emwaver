//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptsUI
import EMWaverScriptSwiftUI
import EMWaverScriptModel
import EMWaverScriptRuntime

// Remote overlay UI renders ScriptTree using ScriptRenderView

struct ContentView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @ObservedObject var hostSessions: HostSessionManager
    @ObservedObject var remoteControlHost: RemoteControlHostService
    @ObservedObject var scriptSessions: MacScriptSessionManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var appRouter: AppRouter
    @Environment(\.openURL) private var openURL

    let previewManager: ScriptPreviewManager

    @State private var showingSettings: Bool = false
    @State private var autoFirmwarePromptKey: String? = nil

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!

    // When remote control is active, show the remote script UI *in-app* (not as a modal sheet).
    @State private var showingRemoteOverlay: Bool = false

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
            return "esp32s3"
        }
        return device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
    }

    private var currentBoardDisplayName: String {
        switch currentBoardType.lowercased() {
        case "stm32f042":
            return "STM32F042"
        case "esp32s2":
            return "ESP32-S2"
        case "esp32s3":
            return "ESP32-S3"
        case "esp32":
            return "ESP32"
        default:
            return device.connectedPortName ?? "Connected"
        }
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
        return device.discoveredDevices.first(where: { $0.id == id })
    }

    private var selectedLocalDeviceLabel: String {
        guard let selectedLocalDevice else {
            return device.isConnected ? currentBoardDisplayName : "No Device"
        }
        return LocalDeviceLabelFormatter.label(for: selectedLocalDevice)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ScriptsRootView(
                    previewManager: previewManager,
                    device: scriptDeviceBridge,
                    agentEndpointProvider: {
                        auth.agentEndpointConfig
                    },
                    hostStatusSink: { running, name in
                        // Treat "preview showing" as "script running" on macOS.
                        hostSessions.setScriptStatus(running: running, activeScriptName: name)
                    },
                    agentEnabled: auth.isSignedIn,
                    onRequestAgentUpgrade: {
                        auth.isSignInSheetPresented = true
                    },
                    onRequestOpenSettings: {
                        showingSettings = true
                    },
                    leadingHeaderItem: nil,
                    agentLeadingToolbarItem: AnyView(agentKeyToolbarItem),
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

                if showingRemoteOverlay {
                    VStack(spacing: 0) {
                        HStack {
                            Label("Local Script Sessions", systemImage: "antenna.radiowaves.left.and.right")
                                .font(.headline)

                            Spacer()

                            if let n = remoteControlHost.remoteActiveScriptName, !n.isEmpty {
                                Text(n)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Button("Done") {
                                showingRemoteOverlay = false
                            }
                            .keyboardShortcut(.escape, modifiers: [])
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial)

                        Divider()

                        HStack(spacing: 0) {
                            List(selection: Binding(
                                get: { remoteControlHost.selectedRemoteScriptInstanceId },
                                set: { id in if let id { remoteControlHost.selectRemoteSession(id) } }
                            )) {
                                ForEach(remoteControlHost.remoteScriptSessions) { session in
                                    HStack(alignment: .top, spacing: 8) {
                                        VStack(alignment: .leading, spacing: 3) {
                                            Text(session.name)
                                                .font(.subheadline.weight(.semibold))
                                                .lineLimit(1)
                                            if let deviceID = session.deviceID, !deviceID.isEmpty {
                                                Text(deviceID)
                                                    .font(.caption2.monospaced())
                                                    .foregroundStyle(.secondary)
                                                    .lineLimit(1)
                                            } else {
                                                Text("Active device")
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                        Spacer(minLength: 4)
                                        Button {
                                            remoteControlHost.stopRemoteSession(session.id)
                                        } label: {
                                            Image(systemName: "stop.fill")
                                        }
                                        .buttonStyle(.borderless)
                                        .foregroundStyle(.red)
                                        .help("Stop this script")
                                    }
                                    .tag(session.id)
                                    .contextMenu {
                                        Button("Stop Script", role: .destructive) {
                                            remoteControlHost.stopRemoteSession(session.id)
                                        }
                                    }
                                }
                            }
                            .frame(width: 260)

                            Divider()

                            if let tree = remoteControlHost.remoteScriptTree {
                                ScriptRenderView(tree: tree) { token, args in
                                    remoteControlHost.invokeRemoteHandler(token: token, arguments: args)
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                                .background(Color.black.opacity(0.12))
                            } else {
                                VStack(spacing: 10) {
                                    ProgressView()
                                    Text("Local script session is active, waiting for UI…")
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.thinMaterial)
                    .transition(.opacity)
                }
            }
            .overlay(alignment: .top) {
                Divider()
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                localDevicePicker
            }

            ToolbarItem(placement: .automatic) {
                if remoteControlHost.isRemoteControlled || !remoteControlHost.remoteScriptSessions.isEmpty {
                    Button {
                        showingRemoteOverlay = true
                    } label: {
                        HStack(spacing: 8) {
                            Label("Sessions", systemImage: "square.stack.3d.up")
                            if !remoteControlHost.remoteScriptSessions.isEmpty {
                                Text("\(remoteControlHost.remoteScriptSessions.count)")
                                    .foregroundStyle(.secondary)
                            } else if let n = remoteControlHost.remoteActiveScriptName, !n.isEmpty {
                                Text(n)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .help("Local script sessions are running. Click to view and switch between them.")
                }
            }
        }
        .sheet(isPresented: $auth.isSignInSheetPresented) {
            SignInSheet()
                .environmentObject(auth)
        }
        .sheet(isPresented: $appRouter.isDeviceSheetPresented) {
            DeviceConnectionSheet(device: device, firmwareUpdater: firmwareUpdater)
        }
        .sheet(isPresented: $firmwareUpdater.isPresented) {
            FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        // Remote UI is shown in-app via an overlay (no sheet).
        // Agent lives in the right-side drawer (ScriptsRootView) on macOS.
        .task {
            scriptSessions.attach(device: device)
            await auth.waitForInitialRestore()
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
            if device.discoveredDevices.isEmpty {
                Text("No local devices")
                    .foregroundStyle(.secondary)
            } else {
                Picker("Local Device", selection: Binding(
                    get: { scriptSessions.selectedDeviceID },
                    set: { selectedID in
                        scriptSessions.selectedDeviceID = selectedID
                        if let selectedID,
                           let item = device.discoveredDevices.first(where: { $0.id == selectedID }),
                           item.connectionState != .connected {
                            device.connectDevice(id: selectedID)
                        }
                    }
                )) {
                    ForEach(device.discoveredDevices) { item in
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

    @ViewBuilder
    private var agentKeyToolbarItem: some View {
        if auth.isSignedIn {
            Menu {
                Text("Saved locally")
                    .foregroundStyle(.secondary)

                Button("Manage Key…") {
                    auth.isSignInSheetPresented = true
                }

                Button {
                    openURL(mgptApiURL)
                } label: {
                    Label("MGPT API Platform", systemImage: "globe")
                }

                Divider()

                Button(role: .destructive) {
                    Task { await auth.removeKey() }
                } label: {
                    Text("Remove Key")
                }
            } label: {
                Image(systemName: "key.fill")
            }
            .help("Manage Agent API key")
        } else {
            Button {
                auth.isSignInSheetPresented = true
            } label: {
                Image(systemName: "key.slash")
            }
            .help("Set up Agent API key")
        }
    }
}

#Preview {
    ContentView(
        device: MacUSBManager(),
        firmwareUpdater: FirmwareUpdateManager(),
        hostSessions: HostSessionManager(),
        remoteControlHost: RemoteControlHostService(),
        scriptSessions: MacScriptSessionManager(),
        previewManager: ScriptPreviewManager()
    )
    .environmentObject(AuthenticationManager())
    .environmentObject(AppRouter())
}
