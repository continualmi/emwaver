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
}
