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
    @State private var showWelcome: Bool = false
    
    var body: some View {
        ZStack {
            TabView(selection: $selection) {
                // Main Views - these always appear in the tab bar
                NavigationView {
                    EMWaverView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("EMWaver", systemImage: "house")
                }
                .tag("EMWaver")
                
                ButtonsView()
                .tabItem {
                    Label("Buttons", systemImage: "apps.iphone")
                }
                .tag("Buttons")
                    
                NavigationView {
                    SamplerView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Sampler", systemImage: "waveform")
                }
                .tag("Sampler")
                    
                NavigationView {
                    ConsoleView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Console", systemImage: "text.and.command.macwindow")
                }
                .tag("Console")
                
                // "More" tab views - use different approach to avoid duplicate navigation bars
                ISMView()
                .tabItem {
                    Label("ISM", systemImage: "memorychip")
                }
                .tag("ISM")
                    
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
                
                // Check if this is the first launch
                checkFirstLaunch()
            }
            
            // Show welcome screen if it's the first launch
            if showWelcome {
                WelcomeView(onDismiss: {
                    withAnimation(.easeInOut(duration: 0.5)) {
                        showWelcome = false
                    }
                    // Mark that user has seen the welcome screen
                    UserDefaults.standard.set(true, forKey: "hasSeenWelcome")
                })
                .transition(.opacity)
                .zIndex(1)
            }
        }
    }
    
    private func checkFirstLaunch() {
        let hasSeenWelcome = UserDefaults.standard.bool(forKey: "hasSeenWelcome")
        if !hasSeenWelcome {
            showWelcome = true
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(BLEManager())
}
