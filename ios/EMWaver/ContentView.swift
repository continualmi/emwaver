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
                    Image("TabEMWaver").renderingMode(.template)
                    Text("EMWaver")
                }
                .tag("EMWaver")

                NavigationView {
                    ISMView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabISM").renderingMode(.template)
                    Text("ISM")
                }
                .tag("ISM")

                NavigationView {
                    SamplerView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabSampler").renderingMode(.template)
                    Text("Sampler")
                }
                .tag("Sampler")

                NavigationView {
                    WaveletsView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabWavelets").renderingMode(.template)
                    Text("Wavelets")
                }
                .tag("Wavelets")

                NavigationView {
                    GitView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabGit").renderingMode(.template)
                    Text("Git")
                }
                .tag("Git")

                NavigationView {
                    FlashView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    FlashTabIcon()
                    Text("Flash")
                }
                .tag("Flash")

                NavigationView {
                    PacketModeView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabPacket").renderingMode(.template)
                    Text("Packet")
                }
                .tag("PacketMode")

                NavigationView {
                    RFIDView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabRFID").renderingMode(.template)
                    Text("RFID")
                }
                .tag("RFID")

                NavigationView {
                    SettingsView()
                }
                .navigationViewStyle(StackNavigationViewStyle())
                .tabItem {
                    Image("TabSettings").renderingMode(.template)
                    Text("Settings")
                }
                .tag("Settings")
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
