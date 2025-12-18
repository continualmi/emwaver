//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var bleManager: BLEManager
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var selection: String = "EMWaver"
    @State private var showWelcome: Bool = false
    
    var body: some View {
        ZStack {
            TabView(selection: $selection) {
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

                NavigationView {
                    GitView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Git", systemImage: "arrow.triangle.branch")
                }
                .tag("Git")
                
                NavigationView {
                    PacketModeView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("Packet", systemImage: "dot.radiowaves.left.and.right")
                }
                .tag("PacketMode")
                
                NavigationView {
                    RFIDView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Label("RFID", systemImage: "creditcard")
                }
                .tag("RFID")
            }
            .onAppear {
                let appearance = UINavigationBarAppearance()
                appearance.configureWithOpaqueBackground()
                UINavigationBar.appearance().standardAppearance = appearance
                UINavigationBar.appearance().compactAppearance = appearance
                UINavigationBar.appearance().scrollEdgeAppearance = appearance
                checkFirstLaunch()
            }

            if showWelcome {
                WelcomeView(onDismiss: {
                    withAnimation(.easeInOut(duration: 0.5)) {
                        showWelcome = false
                    }
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
        .environmentObject(AuthenticationManager())
}
