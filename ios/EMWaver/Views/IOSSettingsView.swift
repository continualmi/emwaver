/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

struct IOSSettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("App") {
                    LabeledContent("Version", value: IOSAppBuildInfo.displayVersion)
                    LabeledContent("Build", value: IOSAppBuildInfo.buildNumber)
                    if !IOSAppBuildInfo.commitShort.isEmpty {
                        LabeledContent("Commit", value: IOSAppBuildInfo.commitShort)
                    }
                }

                Section("Local-first") {
                    Text("Local scripts and hardware control work without an EMWaver account or cloud activation.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    IOSSettingsView()
}
