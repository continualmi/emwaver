//
//  EMWaverApp.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

@main
struct EMWaverApp: App {
    @StateObject private var bleManager = BLEManager()
    @StateObject private var authManager = AuthenticationManager()
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(bleManager)
                .environmentObject(authManager)
        }
    }
}
