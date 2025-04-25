//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @State private var selection: String? = "BLE"
    
    var body: some View {
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
