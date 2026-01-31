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
    @StateObject private var agentViewModel = AgentChatViewModel()
    @State private var showingAgentChat = false

    var body: some View {
        NavigationStack {
            ScriptsRootView(device: bleManager)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(connectionStatusColor)
                                .frame(width: 8, height: 8)
                            Text(connectionStatusText)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .accessibilityElement(children: .combine)
                    }

                    ToolbarItem(placement: .navigationBarTrailing) {
                        Menu {
                            Button("Agent") {
                                showingAgentChat = true
                            }

                            Divider()

                            Button("Refresh Ports") {
                                bleManager.refreshPorts()
                            }

                            if bleManager.isConnected {
                                Button("Disconnect", role: .destructive) {
                                    bleManager.disconnect()
                                }
                            } else {
                                Button(bleManager.isScanning ? "Scanning…" : "Connect") {
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
                            Image(systemName: "cable.connector")
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
