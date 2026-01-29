//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptsUI

struct ContentView: View {
    @ObservedObject var device: MacUSBManager

    var body: some View {
        ScriptsRootView(device: device)
    }
}

#Preview {
    ContentView(device: MacUSBManager())
}
