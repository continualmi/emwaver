//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: String? = "BLE"
    @State private var tabSelection: String = "BLE"
    
    var body: some View {
        TabView(selection: $tabSelection) {
            mainNavigationView(for: "BLE")
                .tabItem {
                    Label("BLE", systemImage: "dot.radiowaves.left.and.right")
                }
                .tag("BLE")
            
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
                if ["BLE", "ISM", "Sampler", "Console", "Buttons"].contains(newValue) {
                    tabSelection = newValue
                }
            }
        }
    }
    
    @ViewBuilder
    private func mainNavigationView(for initialSelection: String) -> some View {
        NavigationSplitView {
            List(selection: $selection) {
                NavigationLink(value: "BLE") {
                    Label("BLE", systemImage: "dot.radiowaves.left.and.right")
                }
                NavigationLink(value: "ISM") {
                    Label("ISM", systemImage: "memorychip")
                }
                NavigationLink(value: "RFID") {
                    Label("RFID", systemImage: "dot.radiowaves.forward")
                }
                NavigationLink(value: "2.4 GHz") {
                    Label("2.4 GHz", systemImage: "antenna.radiowaves.left.and.right")
                }
                NavigationLink(value: "BadUSB") {
                    Label("Bad-USB", systemImage: "keyboard")
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
                NavigationLink(value: "Firmware") {
                    Label("Firmware Update", systemImage: "arrow.up.circle")
                }
                // TODO: Add Serial Monitor, Flasher when views are created
                NavigationLink(value: "Template") {
                    Label("Template", systemImage: "pencil.and.ruler")
                }
                NavigationLink(value: "Settings") {
                    Label("Settings", systemImage: "gearshape")
                }
            }
            .navigationTitle("EMWaver")
        } detail: {
            switch selection {
            case "BLE":
                BLEView()
            case "ISM":
                ISMView()
            case "RFID":
                RFIDView()
            case "2.4 GHz":
                GHz24View()
            case "BadUSB":
                BadUSBView()
            case "Sampler":
                SamplerView()
            case "Buttons":
                ButtonsView()
            case "Console":
                ConsoleView()
            case "Firmware":
                FirmwareUpdateView()
            case "Template":
                TemplateView()
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
