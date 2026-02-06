import SwiftUI

struct HostsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var auth: AuthenticationManager

    @StateObject private var directory = HostDirectory()

    var body: some View {
        NavigationStack {
            HostsListView(directory: directory)
                .navigationTitle("Hosts")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Refresh") {
                            Task { await directory.refresh(auth: auth) }
                        }
                    }
                }
                .onAppear {
                    Task { await directory.refresh(auth: auth) }
                }
        }
    }
}

private struct HostsListView: View {
    @ObservedObject var directory: HostDirectory

    var body: some View {
        List {
            if !directory.lastErrorText.isEmpty {
                Section {
                    Text(directory.lastErrorText)
                        .foregroundStyle(.secondary)
                        .font(.callout)
                }
            }

            Section {
                if directory.hosts.isEmpty {
                    Text("No host sessions detected")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(directory.hosts) { h in
                        HostRow(host: h)
                    }
                }
            }
        }
    }

    private struct HostRow: View {
        let host: HostSession

        var body: some View {
            NavigationLink {
                RemoteHostControlView(host: host)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Circle()
                        .fill(host.online ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(host.device_name.isEmpty ? host.id : host.device_name)
                        .font(.headline)
                    Spacer()
                    Text(host.usbConnected ? "USB" : "No USB")
                        .foregroundStyle(host.usbConnected ? .primary : .secondary)
                        .font(.subheadline)
                }

                Text([host.platform, host.app_version.isEmpty ? nil : "v\(host.app_version)"].compactMap { $0 }.joined(separator: " · "))
                    .foregroundStyle(.secondary)
                    .font(.callout)

                if host.usbConnected, !host.connectedPort.isEmpty {
                    Text("Port: \(host.connectedPort)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if host.scriptRunning {
                    Text(host.activeScriptName.isEmpty ? "Script running" : "Running: \(host.activeScriptName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
                }
            }
        }
    }
}

#Preview {
    HostsSheet()
        .environmentObject(AuthenticationManager())
}
