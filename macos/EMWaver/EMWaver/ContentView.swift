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
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var appRouter: AppRouter
    @Environment(\.openURL) private var openURL

    let previewManager: ScriptPreviewManager

    @State private var showingSettings: Bool = false

    @State private var autoFirmwarePromptKey: String? = nil

    private let mgptApiURL = URL(string: "https://mdl.continualmi.com/mgpt-api")!
    private let accountURL = URL(string: "https://mdl.continualmi.com/account")!

    // When remote control is active, show the remote script UI *in-app* (not as a modal sheet).
    @State private var showingRemoteOverlay: Bool = false

    private var toolbarDeviceStatus: (icon: String, text: String) {
        if device.isConnected {
            if device.connectedTransportKind == "BLE" {
                return ("antenna.radiowaves.left.and.right", currentBoardDisplayName)
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
        case "esp32s3":
            return "ESP32-S3"
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
                    }
                )
                .id(scriptDeviceAttachmentKey)

                if showingRemoteOverlay {
                    VStack(spacing: 0) {
                        HStack {
                            Label("Remote Control", systemImage: "antenna.radiowaves.left.and.right")
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

                        if let tree = remoteControlHost.remoteScriptTree {
                            ScriptRenderView(tree: tree) { token, args in
                                remoteControlHost.invokeRemoteHandler(token: token, arguments: args)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                            .background(Color.black.opacity(0.12))
                        } else {
                            VStack(spacing: 10) {
                                ProgressView()
                                Text("Remote control is active, waiting for UI…")
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.thinMaterial)
                    .transition(.opacity)
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button {
                    appRouter.isDeviceSheetPresented = true
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: toolbarDeviceStatus.icon)
                            .imageScale(.medium)
                            .frame(width: 16, alignment: .center)

                        Text(toolbarDeviceStatus.text)
                    }
                    .padding(.horizontal, 8)
                }
                .buttonStyle(.plain)
                .help("Device / connection options")
            }

            ToolbarItem(placement: .automatic) {
                if remoteControlHost.isRemoteControlled {
                    Button {
                        showingRemoteOverlay = true
                    } label: {
                        HStack(spacing: 8) {
                            Label("Remote", systemImage: "antenna.radiowaves.left.and.right")
                            if let n = remoteControlHost.remoteActiveScriptName, !n.isEmpty {
                                Text(n)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                    }
                    .help("This host is being controlled remotely. Click to open the remote script UI.")
                }
            }

            ToolbarItem(placement: .automatic) {
                if auth.isSignedIn {
                    Menu {
                        Text("Saved locally")
                            .foregroundStyle(.secondary)

                        Button("Manage Key…") {
                            auth.isSignInSheetPresented = true
                        }

                        Button("Open MGPT API Keys") {
                            openURL(mgptApiURL)
                        }

                        Button("Open Account & Credits") {
                            openURL(accountURL)
                        }

                        Divider()

                        Button(role: .destructive) {
                            Task { await auth.removeKey() }
                        } label: {
                            Text("Remove Key")
                        }

                    } label: {
                        Label("Agent Key", systemImage: "key.fill")
                    }
                } else {
                    Button {
                        auth.isSignInSheetPresented = true
                    } label: {
                        Label("Enter Key", systemImage: "key.fill")
                    }
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
            await auth.waitForInitialRestore()
            firmwareUpdater.refreshDfuPresence()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                triggerAutomaticFirmwarePromptIfNeeded()
            }
        }
        .onChange(of: device.connectedBoardType) { _ in
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.isConnected) { connected in
            if !connected && !firmwareUpdater.dfuConnected {
                autoFirmwarePromptKey = nil
            }
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.deviceEmwaverVersion) { _ in
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: firmwareUpdater.dfuConnected) { connected in
            if !connected {
                autoFirmwarePromptKey = nil
            }
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: firmwareUpdater.updateDone) { done in
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
}

#Preview {
    ContentView(
        device: MacUSBManager(),
        firmwareUpdater: FirmwareUpdateManager(),
        hostSessions: HostSessionManager(),
        remoteControlHost: RemoteControlHostService(),
        previewManager: ScriptPreviewManager()
    )
    .environmentObject(AuthenticationManager())
    .environmentObject(AppRouter())
}
