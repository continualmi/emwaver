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

    let previewManager: ScriptPreviewManager

    @State private var showingDeviceSheet: Bool = false
    @State private var showingHosts: Bool = false
    @State private var showingBackendSettings: Bool = false

    // When remote control is active, show the remote script UI *in-app* (not as a modal sheet).
    @State private var showingRemoteOverlay: Bool = false

    var body: some View {
        NavigationStack {
            ZStack {
                ScriptsRootView(
                    previewManager: previewManager,
                    device: device,
                    syncProvider: {
                    // Backend base URL is controlled by BackendUrl (supports a hard switch to Azure prod).
                    guard let base = BackendUrl.resolve() else { return nil }

                    // For local dev: allow sync without sign-in when backend auth is disabled.
                    // Set in Xcode Scheme env vars: EMWAVER_ALLOW_ANON_SYNC=1
                    let allowAnonSync = (ProcessInfo.processInfo.environment["EMWAVER_ALLOW_ANON_SYNC"] == "1")

                    if let session = auth.session, !session.idToken.isEmpty {
                        return (baseURL: base, accessToken: session.idToken)
                    }

                    if allowAnonSync {
                        return (baseURL: base, accessToken: "")
                    }

                    return nil
                },
                    hostStatusSink: { running, name in
                        // Treat "preview showing" as "script running" on macOS.
                        hostSessions.setScriptStatus(running: running, activeScriptName: name)
                    }
                )

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
                    showingDeviceSheet = true
                } label: {
                    HStack(spacing: 8) {
                        if device.isConnected {
                            Label(device.connectedPortName ?? "Connected", systemImage: "cable.connector")
                        } else if firmwareUpdater.dfuConnected {
                            Label("Update Mode", systemImage: "arrow.triangle.2.circlepath")
                        } else {
                            Label("Disconnected", systemImage: "cable.connector.slash")
                        }

                        if device.isConnected, let v = device.deviceEmwaverVersion, !v.isEmpty {
                            Text("EMWaver \(v)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .buttonStyle(.plain)
                .help("Device / connection options")
            }

            ToolbarItem(placement: .automatic) {
                Button {
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

                        Button("Backend…") {
                            showingBackendSettings = true
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
        .sheet(isPresented: $showingDeviceSheet) {
            DeviceConnectionSheet(device: device, firmwareUpdater: firmwareUpdater)
        }
        .sheet(isPresented: $showingHosts) {
            NavigationStack {
                HostsView(directory: hostDirectory) {
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
        .sheet(isPresented: $showingBackendSettings) {
            BackendSettingsView()
        }
        // Remote UI is shown in-app via an overlay (no sheet).
        // Agent lives in the right-side drawer (ScriptsRootView) on macOS.

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
}
