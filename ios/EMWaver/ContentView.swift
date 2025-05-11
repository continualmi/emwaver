//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var bleManager: BLEManager
    @State private var selection: String = "EMWaver"
    
    var body: some View {
        TabView(selection: $selection) {
            // Main Views - these always appear in the tab bar
            NavigationView {
                EMWaverView()
            }
            .tabItem {
                Label("EMWaver", systemImage: "house")
            }
            .tag("EMWaver")
            
            NavigationView {
                ISMView()
            }
            .tabItem {
                Label("ISM", systemImage: "memorychip")
            }
            .tag("ISM")
                
            NavigationView {
                SamplerView()
            }
            .tabItem {
                Label("Sampler", systemImage: "waveform")
            }
            .tag("Sampler")
                
            NavigationView {
                ConsoleView()
            }
            .tabItem {
                Label("Console", systemImage: "text.and.command.macwindow")
            }
            .tag("Console")
            
            // "More" tab views - use different approach to avoid duplicate navigation bars
            RFIDView()
            .tabItem {
                Label("RFID", systemImage: "dot.radiowaves.forward")
            }
            .tag("RFID")
                
            GPIOView()
            .tabItem {
                Label("GPIO", systemImage: "cpu")
            }
            .tag("GPIO")
                
            ButtonsView()
            .tabItem {
                Label("Buttons", systemImage: "apps.iphone")
            }
            .tag("Buttons")
                
            SettingsView()
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag("Settings")
        }
        .onAppear {
            // Set up consistent navigation bar appearance
            let appearance = UINavigationBarAppearance()
            appearance.configureWithOpaqueBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().compactAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(BLEManager())
}
