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
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(bleManager)
                .environmentObject(auth)
        }
    }
}
