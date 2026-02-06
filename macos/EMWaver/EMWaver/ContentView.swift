//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptsUI

struct ContentView: View {
    @ObservedObject var device: MacUSBManager
    @ObservedObject var firmwareUpdater: FirmwareUpdateManager
    @ObservedObject var hostSessions: HostSessionManager
    @ObservedObject var hostDirectory: HostDirectory
    @EnvironmentObject private var auth: AuthenticationManager

    @State private var showingDeviceSheet: Bool = false
    @State private var showingAgentChat: Bool = false

    var body: some View {
        NavigationStack {
            ScriptsRootView(
                device: device,
                syncProvider: {
                    // Backend URL resolution order:
                    // 1) EMWAVER_BACKEND_URL env var (parity with Windows)
                    // 2) UserDefaults key emwaver.agent.backendURL
                    let envURL = (ProcessInfo.processInfo.environment["EMWAVER_BACKEND_URL"] ?? "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    let defaultsURL = (UserDefaults.standard.string(forKey: "emwaver.agent.backendURL") ?? "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)

                    let raw = !envURL.isEmpty ? envURL : defaultsURL
                    guard let base = URL(string: raw), !raw.isEmpty else { return nil }

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

            ToolbarItemGroup(placement: .automatic) {
                NavigationLink {
                    HostsView(directory: hostDirectory) {
                        await hostDirectory.refresh(auth: auth)
                    }
                } label: {
                    Label("Hosts", systemImage: "dot.radiowaves.left.and.right")
                }
                .help("View host sessions on this account")

                Button {
                    showingAgentChat = true
                } label: {
                    Label("Agent", systemImage: "sparkles")
                }

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
        .sheet(isPresented: $showingDeviceSheet) {
            DeviceConnectionSheet(device: device, firmwareUpdater: firmwareUpdater)
        }
        .sheet(isPresented: $showingAgentChat) {
            NavigationStack {
                MacAgentChatSheet(auth: auth)
                    .navigationTitle("Agent")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { showingAgentChat = false }
                        }
                    }
            }
            .frame(minWidth: 560, minHeight: 520)
        }
    }
}

#Preview {
    ContentView(
        device: MacUSBManager(),
        firmwareUpdater: FirmwareUpdateManager(),
        hostSessions: HostSessionManager(),
        hostDirectory: HostDirectory()
    )
    .environmentObject(AuthenticationManager())
}
