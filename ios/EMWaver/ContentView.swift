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
                
                NavigationView {
                    ISMView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("ISM", systemImage: "memorychip")
                }
                .tag("ISM")

                NavigationView {
                    SamplerView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Sampler", systemImage: "waveform")
                }
                .tag("Sampler")
                    
                NavigationView {
                    WaveletsView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Wavelets", systemImage: "text.and.command.macwindow")
                }
                .tag("Wavelets")
                
                ButtonsView()
                .tabItem {
                    Label("Buttons", systemImage: "apps.iphone")
                }
                .tag("Buttons")
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
