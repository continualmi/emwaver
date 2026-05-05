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

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager
    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var hostSessions: HostSessionManager
    @EnvironmentObject private var remoteControlHost: RemoteControlHostService
    @State private var showingHosts = false

    @State private var showingRemoteOverlay = false

    var body: some View {
        NavigationStack {
            ZStack {
                ScriptsRootView(
                    device: bleManager,
                    agentCloudProvider: {
                        auth.agentEndpointConfig
                    },
                    hostStatusSink: { running, name in
                        // Treat preview showing as script running on iOS.
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

                            Button("Done") { showingRemoteOverlay = false }
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
                }
            }
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
                        if CloudConfig.hostedServicesEnabled() {
                            Button {
                                showingHosts = true
                            } label: {
                                Image(systemName: "dot.radiowaves.left.and.right")
                            }
                        }

                        if remoteControlHost.isRemoteControlled {
                            Button {
                                showingRemoteOverlay = true
                            } label: {
                                Image(systemName: "antenna.radiowaves.left.and.right")
                            }
                            .accessibilityLabel("Remote control active")
                        }

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
        .sheet(isPresented: $showingHosts) {
            HostsSheet()
                .environmentObject(auth)
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
}
