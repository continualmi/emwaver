//
//  ContentView.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI

#if canImport(EMWaverScriptSwiftUI) && canImport(EMWaverScriptModel)
import EMWaverScriptSwiftUI
import EMWaverScriptModel
#endif

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("EMWaver")
                .font(.title)
                .fontWeight(.semibold)

#if canImport(EMWaverScriptSwiftUI) && canImport(EMWaverScriptModel)
            ScriptRendererSmokeTestView()
#else
            Text("Add the local Swift package at apple/EMWaverAppleCore to enable the script UI renderer.")
                .foregroundStyle(.secondary)

            Text("Xcode: File > Add Packages... > Add Local... > apple/EMWaverAppleCore")
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
#endif
        }
        .padding(16)
    }
}

#Preview {
    ContentView()
}

#if canImport(EMWaverScriptSwiftUI) && canImport(EMWaverScriptModel)
private struct ScriptRendererSmokeTestView: View {
    private let tree: ScriptTree = {
        let root = ScriptNode(
            id: "root",
            type: .column,
            props: ScriptNodeProps(raw: [
                "spacing": 10,
                "padding": 12,
            ]),
            children: [
                ScriptNode(
                    id: "t1",
                    type: .text,
                    props: ScriptNodeProps(raw: [
                        "text": "Script UI renderer is wired.",
                        "font": "headline",
                    ])
                ),
                ScriptNode(
                    id: "t2",
                    type: .logViewer,
                    props: ScriptNodeProps(raw: [
                        "text": "print(\\\"hello\\\")\\nBS: 42\\n...",
                        "cornerRadius": 8,
                        "fillsWidth": true,
                    ])
                ),
            ]
        )
        return ScriptTree(root: root)
    }()

    var body: some View {
        ScriptRenderView(tree: tree, invokeHandler: { _, _ in })
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
#endif
