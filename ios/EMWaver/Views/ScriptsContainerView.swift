/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import EMWaverScriptsUI
import EMWaverScriptRuntime

struct ScriptsContainerView: View {
    @EnvironmentObject var bleManager: USBManager

    var body: some View {
        ScriptsRootView(device: bleManager)
    }
}
