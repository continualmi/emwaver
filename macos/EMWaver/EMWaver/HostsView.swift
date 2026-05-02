import SwiftUI
import AppKit

struct HostsView: View {
    @ObservedObject var directory: HostDirectory

    let onRefresh: () async -> Void

    // macOS List + NavigationLink inside a sheet can behave like a selection-only click.
    // Use an explicit sheet for control so a single click always opens the controller.
    @State private var controllingHost: HostSession?

    var body: some View {
        List {
            if !directory.lastErrorText.isEmpty {
                Section {
                    Text(directory.lastErrorText)
                        .foregroundStyle(.secondary)
                        .font(.callout)
                } header: {
                    Text("Host Sessions")
                }
            }

            Section {
                if directory.hosts.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No host sessions detected")
                            .font(.headline)
                        Text("A host session appears when an EMWaver app with a saved key sends heartbeats to the backend.")
                            .foregroundStyle(.secondary)
                            .font(.callout)
                    }
                    .padding(.vertical, 8)
                } else {
                    ForEach(directory.hosts) { h in
                        Button {
                            controllingHost = h
                        } label: {
                            HostRow(host: h)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Copy Host ID") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(h.id, forType: .string)
                            }
                        }
                    }
                }
            } header: {
                HStack {
                    Text("Host Sessions")
                    Spacer()
                    if let t = directory.lastUpdatedAt {
                        Text(t, style: .time)
                            .foregroundStyle(.secondary)
                            .font(.caption)
                    }
                }
            }
        }
        .navigationTitle("Hosts")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button("Refresh") {
                    Task { await onRefresh() }
                }
            }
        }
        .sheet(item: $controllingHost) { host in
            NavigationStack {
                RemoteHostControlView(host: host)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Done") { controllingHost = nil }
                        }
                    }
            }
            .frame(minWidth: 900, minHeight: 560)
        }
    }

    private struct HostRow: View {
        let host: HostSession

        private var headline: String {
            let dn = host.device_name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !dn.isEmpty { return dn }
            return host.id
        }

        private var detailLine: String {
            let plat = host.platform.isEmpty ? "unknown" : host.platform
            var parts: [String] = [plat]
            if !host.app_version.isEmpty { parts.append("v\(host.app_version)") }
            return parts.joined(separator: " · ")
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(host.online ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(headline)
                        .font(.headline)
                    Spacer()

                    if host.usbConnected {
                        Label("USB", systemImage: "cable.connector")
                            .foregroundStyle(.primary)
                            .font(.subheadline)
                    } else {
                        Label("No USB", systemImage: "cable.connector.slash")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                    }
                }

                Text(detailLine)
                    .foregroundStyle(.secondary)
                    .font(.callout)

                if host.usbConnected {
                    let port = host.connectedPort.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !port.isEmpty {
                        Text("Port: \(port)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if host.scriptRunning {
                    let name = host.activeScriptName.trimmingCharacters(in: .whitespacesAndNewlines)
                    Text(name.isEmpty ? "Script running" : "Running: \(name)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
        }
    }
}
