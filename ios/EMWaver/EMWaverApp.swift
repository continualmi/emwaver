/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI

@main
struct EMWaverApp: App {
    @StateObject private var bleManager = USBManager()
    @StateObject private var auth = AuthenticationManager()
    @StateObject private var hostSessions = HostSessionManager()
    @StateObject private var remoteControlHost = RemoteControlHostService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(bleManager)
                .environmentObject(auth)
                .environmentObject(hostSessions)
                .environmentObject(remoteControlHost)
                .task {
                    // Best-effort background heartbeat.
                    hostSessions.start(auth: auth, device: bleManager)

                    // Remote control host WS (web can attach + drive scripts/UI).
                    remoteControlHost.start(auth: auth, device: bleManager, hostSessions: hostSessions)
                }
        }
    }
}
