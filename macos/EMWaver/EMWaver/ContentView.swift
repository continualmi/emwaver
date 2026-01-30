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
    @EnvironmentObject private var auth: AuthenticationManager

    var body: some View {
        ScriptsRootView(device: device)
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    HStack(spacing: 8) {
                        if device.isConnected {
                            Label("Connected", systemImage: "cable.connector")
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
    }
}

#Preview {
    ContentView(device: MacUSBManager(), firmwareUpdater: FirmwareUpdateManager())
        .environmentObject(AuthenticationManager())
}
