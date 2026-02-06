import SwiftUI

import EMWaverScriptModel
import EMWaverScriptSwiftUI

struct RemoteHostControlView: View {
    let host: HostSession

    @EnvironmentObject private var auth: AuthenticationManager
    @EnvironmentObject private var hostSessions: HostSessionManager

    @StateObject private var client = RemoteControlClientService()

    @State private var runName: String = "remote.emw"
    @State private var runSource: String = "UI.render(UI.column({ children: [ UI.text({ text: 'Hello from macOS controller' }) ] }))"

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Circle()
                    .fill(host.online ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)
                Text(host.device_name.isEmpty ? host.id : host.device_name)
                    .font(.headline)
                Spacer()
                Text("WS: \(client.wsStatus)")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            }

            if let err = client.lastError, !err.isEmpty {
                Text(err)
                    .foregroundStyle(.red)
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Run on host (v1 dev UI)")
                        .foregroundStyle(.secondary)
                        .font(.caption)

                    TextField("Name", text: $runName)

                    TextEditor(text: $runSource)
                        .font(.system(.caption, design: .monospaced))
                        .frame(minHeight: 140)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))

                    HStack(spacing: 10) {
                        Button("Attach") {
                            client.attach(to: host.id)
                        }

                        Button("Run") {
                            client.runScript(name: runName, source: runSource)
                        }
                        .disabled(client.attachedHostSessionId == nil)
                    }
                }
                .frame(width: 340)

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Text(client.remoteActiveScriptName ?? "Remote UI")
                        .font(.subheadline)

                    if let tree = client.remoteScriptTree {
                        ScriptRenderView(tree: tree) { token, args in
                            client.invokeToken(token: token, args: args)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else {
                        Text("No remote UI yet. Attach + run.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
        }
        .padding(14)
        .navigationTitle("Control")
        .onAppear {
            client.start(auth: auth, hostSessions: hostSessions)
            client.attach(to: host.id)
        }
        .onDisappear {
            client.stop()
        }
    }
}
