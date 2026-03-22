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
    @ObservedObject var hostDirectory: HostDirectory
    @ObservedObject var remoteControlHost: RemoteControlHostService
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var accountDevices: AccountDevicesService
    @EnvironmentObject private var entitlements: EntitlementsManager
    @EnvironmentObject private var appRouter: AppRouter

    let previewManager: ScriptPreviewManager

    @State private var showingHosts: Bool = false
    @State private var showingSettings: Bool = false

    @State private var showingProUpgrade: Bool = false
    @State private var proFeatureName: String = ""
    @State private var autoFirmwarePromptKey: String? = nil

    // When remote control is active, show the remote script UI *in-app* (not as a modal sheet).
    @State private var showingRemoteOverlay: Bool = false

    private var toolbarDeviceStatus: (icon: String, text: String) {
        if device.isConnected {
            return ("cable.connector", currentBoardDisplayName)
        }
        if (device.connectedBoardType ?? device.lastDetectedBoardType ?? "").caseInsensitiveCompare("esp32s3") == .orderedSame,
           firmwareUpdater.espBootloaderConnected {
            return ("cpu", "ESP Bootloader")
        }
        if firmwareUpdater.dfuConnected {
            return ("arrow.triangle.2.circlepath", "Update Mode")
        }
        return ("cable.connector.slash", "Disconnected")
    }

    private var currentHardwareUidHex: String? {
        let value = device.hardwareUidHex ?? device.lastDetectedHardwareUidHex
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private var currentBoardType: String {
        device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
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

    private var deviceIsClaimed: Bool {
        guard let hardwareUid = currentHardwareUidHex else { return false }
        return accountDevices.hasOfflineAccess(boardType: currentBoardType, hardwareUid: hardwareUid)
    }

    private var needsAutomaticFirmwareRecovery: Bool {
        guard device.isConnected else { return false }
        guard device.deviceEmwaverVersion != nil else { return false }
        guard currentHardwareUidHex == nil else { return false }
        guard device.hardwareUidUnsupportedByFirmware else { return false }
        return currentBoardType.caseInsensitiveCompare("stm32f042") == .orderedSame
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
        guard deviceIsClaimed else { return nil }
        return device
    }

    private var scriptDeviceAttachmentKey: String {
        let hardwareUid = currentHardwareUidHex ?? "none"
        let suffix = (scriptDeviceBridge == nil) ? "blocked" : "ready"
        return "\(currentBoardType)-\(hardwareUid)-\(suffix)"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ScriptsRootView(
                    previewManager: previewManager,
                    device: scriptDeviceBridge,
                    syncProvider: {
                        // Local testing uses the repo root .env bootstrap.
                        guard let base = BackendUrl.resolve() else { return nil }

                        // For local dev: allow sync without sign-in when backend auth is disabled.
                        // Set in Xcode Scheme env vars: EMWAVER_ALLOW_ANON_SYNC=1
                        let allowAnonSync = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")

                        // Pro gating: cloud file sync is Pro-only.
                        if !(entitlements.entitlements?.features.cloudFiles ?? false), !allowAnonSync {
                            return nil
                        }

                        if let session = auth.session, !session.idToken.isEmpty {
                            return (baseURL: base, accessToken: session.idToken)
                        }

                        if allowAnonSync {
                            return (baseURL: base, accessToken: "")
                        }

                        return nil
                    },
                    agentCloudProvider: {
                        // Cloud-stored conversations (Pro-only). We still run inference locally for now.
                        guard (entitlements.entitlements?.features.agent ?? false) else { return nil }
                        guard let base = BackendUrl.resolve() else { return nil }
                        guard let session = auth.session, !session.idToken.isEmpty else { return nil }
                        return (baseURL: base, accessToken: session.idToken)
                    },
                    hostStatusSink: { running, name in
                        // Treat "preview showing" as "script running" on macOS.
                        hostSessions.setScriptStatus(running: running, activeScriptName: name)
                    },
                    agentEnabled: (entitlements.entitlements?.features.agent ?? false),
                    onRequestAgentUpgrade: {
                        proFeatureName = "Agent"
                        showingProUpgrade = true
                    },
                    onRequestSyncUpgrade: {
                        proFeatureName = "Cloud sync"
                        showingProUpgrade = true
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
                    HStack(spacing: 8) {
                        Image(systemName: toolbarDeviceStatus.icon)
                            .imageScale(.medium)
                            .frame(width: 14, alignment: .center)

                        Text(toolbarDeviceStatus.text)
                    }
                    .padding(.leading, 6)
                    .padding(.trailing, 2)
                }
                .buttonStyle(.plain)
                .help("Device / connection options")
            }

            ToolbarItem(placement: .automatic) {
                Button {
                    // Always open the Hosts panel; lock functionality inside if not Pro.
                    showingHosts = true
                } label: {
                    Label("Hosts", systemImage: "dot.radiowaves.left.and.right")
                }
                .help("View host sessions on this account")
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
                        if let email = auth.session?.email, !email.isEmpty {
                            Text(email)
                                .foregroundStyle(.secondary)
                        }

                        Divider()

                        Button("Sign Out") {
                            Task { await auth.signOut() }
                        }
                    } label: {
                        Label(auth.userLabel, systemImage: "person.crop.circle")
                    }
                } else {
                    Button {
                        auth.isSignInSheetPresented = true
                    } label: {
                        Label("Sign In", systemImage: "person.crop.circle.badge.plus")
                    }
                }
            }
        }
        .sheet(isPresented: $auth.isSignInSheetPresented) {
            SignInSheet()
                .environmentObject(auth)
        }
        .sheet(isPresented: $auth.isWebHandoffSheetPresented) {
            WebSignInHandoffSheet()
                .environmentObject(auth)
        }
        .sheet(isPresented: $appRouter.isDeviceSheetPresented) {
            DeviceConnectionSheet(device: device, firmwareUpdater: firmwareUpdater)
                .environmentObject(auth)
                .environmentObject(accountDevices)
        }
        .sheet(isPresented: $firmwareUpdater.isPresented) {
            FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
                .environmentObject(auth)
                .environmentObject(accountDevices)
        }
        .sheet(isPresented: $showingHosts) {
            NavigationStack {
                HostsView(
                    directory: hostDirectory,
                    proEnabled: (entitlements.entitlements?.features.cloudHosts ?? false),
                    onRequestUpgrade: {
                        proFeatureName = "Remote host sessions"
                        showingProUpgrade = true
                    }
                ) {
                    await hostDirectory.refresh(auth: auth)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { showingHosts = false }
                    }
                }
            }
            .frame(minWidth: 560, minHeight: 520)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .sheet(isPresented: $showingProUpgrade) {
            ProUpgradeSheet(entitlements: entitlements, featureName: proFeatureName)
                .environmentObject(auth)
        }
        // Remote UI is shown in-app via an overlay (no sheet).
        // Agent lives in the right-side drawer (ScriptsRootView) on macOS.
        .task {
            await entitlements.refresh(auth: auth, force: true)
            firmwareUpdater.refreshDfuPresence()
            syncConnectedDeviceAccessIfNeeded()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                triggerAutomaticFirmwarePromptIfNeeded()
            }
        }
        .onChange(of: auth.isSignedIn) { _ in
            Task { await entitlements.refresh(auth: auth, force: true) }
            syncConnectedDeviceAccessIfNeeded()
        }
        .onChange(of: device.hardwareUidHex) { _ in
            accountDevices.refresh(auth: auth)
            syncConnectedDeviceAccessIfNeeded()
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.lastDetectedHardwareUidHex) { _ in
            accountDevices.refresh(auth: auth)
            syncConnectedDeviceAccessIfNeeded()
        }
        .onChange(of: device.connectedBoardType) { _ in
            accountDevices.refresh(auth: auth)
            syncConnectedDeviceAccessIfNeeded()
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.lastDetectedBoardType) { _ in
            accountDevices.refresh(auth: auth)
            syncConnectedDeviceAccessIfNeeded()
        }
        .onChange(of: device.isConnected) { connected in
            if !connected && !firmwareUpdater.dfuConnected {
                autoFirmwarePromptKey = nil
            }
            syncConnectedDeviceAccessIfNeeded()
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.deviceEmwaverVersion) { _ in
            triggerAutomaticFirmwarePromptIfNeeded()
        }
        .onChange(of: device.hardwareUidUnsupportedByFirmware) { _ in
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

    private func syncConnectedDeviceAccessIfNeeded() {
        guard device.isConnected else { return }
        guard let hardwareUid = currentHardwareUidHex else { return }
        accountDevices.syncSeenDevice(boardType: currentBoardType, hardwareUid: hardwareUid, auth: auth)
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
        hostDirectory: HostDirectory(),
        remoteControlHost: RemoteControlHostService(),
        previewManager: ScriptPreviewManager()
    )
    .environmentObject(AuthenticationManager())
    .environmentObject(AccountDevicesService())
    .environmentObject(EntitlementsManager())
    .environmentObject(AppRouter())
}
