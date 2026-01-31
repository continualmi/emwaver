/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import EMWaverScriptsUI
import EMWaverScriptRuntime

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager
    @EnvironmentObject private var auth: AuthenticationManager
    @StateObject private var agentViewModel = AgentChatViewModel()
    @State private var showingAgentChat = false

    var body: some View {
        NavigationStack {
            ScriptsRootView(device: bleManager)
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
                                Image(systemName: "person.crop.circle")
                            }
                        } else {
                            Button {
                                auth.isSignInSheetPresented = true
                            } label: {
                                Image(systemName: "person.crop.circle.badge.plus")
                            }
                        }

                        Button {
                            showingAgentChat = true
                        } label: {
                            Image(systemName: "sparkles")
                        }
                    }
                }
        }
        .sheet(isPresented: $showingAgentChat) {
            NavigationStack {
                AgentChatPanelView(viewModel: agentViewModel)
                    .navigationTitle("Agent")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showingAgentChat = false }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $auth.isSignInSheetPresented) {
            SignInSheet()
                .environmentObject(auth)
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
