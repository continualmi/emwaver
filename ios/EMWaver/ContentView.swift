/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var bleManager: USBManager
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

                ScriptsContainerView()
                .tabItem {
                    Image("TabScripts").renderingMode(.template)
                    Text("Scripts")
                }
                .tag("Scripts")
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
        .environmentObject(USBManager())
        .environmentObject(AuthenticationManager())
}
