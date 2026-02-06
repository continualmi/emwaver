import SwiftUI
import EMWaverScriptModel
import EMWaverScriptSwiftUI

struct RemoteHostControlView: View {
    let host: HostSession

    @EnvironmentObject private var auth: AuthenticationManager
    @StateObject private var client = RemoteControlClientService()

    @State private var runName: String = "remote.emw"
    @State private var runSource: String = "// paste script source here\n\nUI.render(UI.column({ children: [ UI.text({ text: 'Hello from remote' }) ] }))"

    var body: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(host.device_name.isEmpty ? host.id : host.device_name)
                    .font(.headline)
                Text([host.platform, host.app_version.isEmpty ? nil : "v\(host.app_version)"].compactMap { $0 }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
                    .font(.callout)

                HStack(spacing: 10) {
                    Text("WS: \(client.wsStatus)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let a = client.attachedHostSessionId {
                        Text("Attached")
                            .font(.caption)
                    } else {
                        Text("Preview")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let err = client.lastError, !err.isEmpty {
                    Text(err)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            // Minimal run UI (dev-focused). Real UX can hook into script list later.
            VStack(alignment: .leading, spacing: 8) {
                Text("Run on host")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                TextField("Name", text: $runName)
                    .textFieldStyle(.roundedBorder)

                TextEditor(text: $runSource)
                    .font(.system(.caption, design: .monospaced))
                    .frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))

                Button("Run") {
                    client.runScript(name: runName, source: runSource)
                }
                .buttonStyle(.borderedProminent)
                .disabled(client.attachedHostSessionId == nil)
            }

            Divider()

            Text(client.remoteActiveScriptName ?? "Remote UI")
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let tree = client.remoteScriptTree {
                RemoteScriptRenderView(tree: tree) { nodeId, ev, value in
                    client.sendUiEvent(targetNodeId: nodeId, event: ev, value: value)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                Text("No remote UI yet. Attach and run a script.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(14)
        .navigationTitle("Control")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            client.start(auth: auth)
            client.attach(to: host.id)
        }
        .onDisappear {
            client.stop()
        }
    }
}

/// Minimal remote renderer that emits `ui.event` by node id + ScriptEventType.
/// This is intentionally small and will be expanded as needed.
private struct RemoteScriptRenderView: View {
    let tree: ScriptTree
    let onEvent: (String, ScriptEventType, Any?) -> Void

    var body: some View {
        renderNode(tree.root)
    }

    @ViewBuilder
    private func renderNode(_ node: ScriptNode) -> some View {
        switch node.type {
        case .column:
            VStack(alignment: node.props.alignment ?? .leading, spacing: node.props.spacing) {
                ForEach(node.children) { child in
                    renderNode(child)
                }
            }
            .applyScriptModifiers(node.props)

        case .row:
            HStack(spacing: node.props.spacing) {
                ForEach(node.children) { child in
                    renderNode(child)
                }
            }
            .applyScriptModifiers(node.props)

        case .text:
            Text(node.props.text ?? "")
                .applyScriptModifiers(node.props)

        case .button:
            Button(action: {
                onEvent(node.id, .tap, nil)
            }) {
                Text(node.props.label ?? "Button")
            }
            .buttonStyle(.borderedProminent)
            .disabled(node.props.handlerId(for: .tap) == nil)
            .applyScriptModifiers(node.props)

        case .slider:
            let r = node.props.sliderRange
            let min = r.lowerBound
            let max = r.upperBound
            let val = node.props.sliderValue ?? min
            VStack(alignment: .leading, spacing: 6) {
                Slider(
                    value: Binding(get: { val }, set: { next in onEvent(node.id, .change, next) }),
                    in: min...max,
                    step: node.props.sliderStep ?? 1
                )
                .disabled(node.props.handlerId(for: .change) == nil)
            }
            .applyScriptModifiers(node.props)

        case .textField:
            TextField(
                node.props.label ?? "",
                text: Binding(
                    get: { node.props.textFieldValue ?? "" },
                    set: { next in onEvent(node.id, .change, next) }
                )
            )
            .textFieldStyle(.roundedBorder)
            .disabled(node.props.handlerId(for: .change) == nil)
            .applyScriptModifiers(node.props)

        case .textEditor:
            TextEditor(
                text: Binding(
                    get: { node.props.textEditorValue ?? "" },
                    set: { next in onEvent(node.id, .change, next) }
                )
            )
            .frame(minHeight: 120)
            .disabled(node.props.handlerId(for: .change) == nil)
            .applyScriptModifiers(node.props)

        case .picker:
            let options = node.props.pickerOptions
            let selected = node.props.pickerSelected ?? ""
            Picker(node.props.label ?? "", selection: Binding(get: { selected }, set: { next in onEvent(node.id, .select, next) })) {
                ForEach(options) { opt in
                    Text(opt.label).tag(opt.value)
                }
            }
            .disabled(node.props.handlerId(for: .select) == nil && node.props.handlerId(for: .change) == nil)
            .applyScriptModifiers(node.props)

        default:
            // Fallback: render children if any
            VStack(alignment: .leading, spacing: 8) {
                ForEach(node.children) { child in
                    renderNode(child)
                }
            }
            .applyScriptModifiers(node.props)
        }
    }
}
