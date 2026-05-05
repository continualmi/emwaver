/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 4/11/25.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        ScriptsContainerView()
    }
}

#Preview {
    ContentView()
        .environmentObject(USBManager())
}
