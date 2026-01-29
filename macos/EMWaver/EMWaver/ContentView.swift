//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptsUI

struct ContentView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house")
                }

            ScriptsRootView()
                .tabItem {
                    Label("Scripts", systemImage: "doc.text")
                }
        }
    }
}

#Preview {
    ContentView()
}

private struct HomeView: View {
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("EMWaver")
                    .font(.largeTitle)
                    .fontWeight(.semibold)

                Text("Home")
                    .font(.title3)
                    .foregroundStyle(.secondary)

                Text("USB device connection UI is next; Scripts is the primary workflow.")
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
            .navigationTitle("Home")
        }
    }
}
