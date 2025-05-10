//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: String? = "EMWaver"
    @State private var tabSelection: String = "RFID"
    
    var body: some View {
        TabView(selection: $tabSelection) {
            mainNavigationView(for: "RFID")
                .tabItem {
                    Label("RFID", systemImage: "dot.radiowaves.forward")
                }
                .tag("RFID")
            
            mainNavigationView(for: "ISM")
                .tabItem {
                    Label("ISM", systemImage: "memorychip")
                }
                .tag("ISM")
            
            mainNavigationView(for: "Sampler")
                .tabItem {
                    Label("Sampler", systemImage: "waveform")
                }
                .tag("Sampler")
            
            mainNavigationView(for: "Console")
                .tabItem {
                    Label("Console", systemImage: "text.and.command.macwindow")
                }
                .tag("Console")
            
            mainNavigationView(for: "Buttons")
                .tabItem {
                    Label("Buttons", systemImage: "apps.iphone")
                }
                .tag("Buttons")
        }
        .onChange(of: tabSelection) { newValue in
            selection = newValue
        }
        .onChange(of: selection) { newValue in
            if let newValue = newValue {
                // Only update tab selection if it matches one of our tabs
                if ["RFID", "ISM", "Sampler", "Console", "Buttons"].contains(newValue) {
                    tabSelection = newValue
                }
            }
        }
    }
    
    @ViewBuilder
    private func mainNavigationView(for initialSelection: String) -> some View {
        NavigationSplitView {
            List(selection: $selection) {
                NavigationLink(value: "EMWaver") {
                    Label("EMWaver", systemImage: "house")
                }
                NavigationLink(value: "ISM") {
                    Label("ISM", systemImage: "memorychip")
                }
                NavigationLink(value: "RFID") {
                    Label("RFID", systemImage: "dot.radiowaves.forward")
                }
                NavigationLink(value: "Sampler") {
                    Label("Sampler", systemImage: "waveform")
                }
                NavigationLink(value: "Buttons") {
                    Label("Buttons", systemImage: "apps.iphone")
                }
                NavigationLink(value: "Console") {
                    Label("Console", systemImage: "text.and.command.macwindow")
                }
                // TODO: Add Serial Monitor, Flasher when views are created
                NavigationLink(value: "Settings") {
                    Label("Settings", systemImage: "gearshape")
                }
            }
            .navigationTitle("EMWaver")
        } detail: {
            switch selection {
            case "EMWaver":
                EMWaverView()
            case "ISM":
                ISMView()
            case "RFID":
                RFIDView()
            case "Sampler":
                SamplerView()
            case "Buttons":
                ButtonsView()
            case "Console":
                ConsoleView()
            case "Settings":
                SettingsView()
            default:
                Text("Select a menu item")
            }
        }
    }
}

#Preview {
    ContentView()
}
