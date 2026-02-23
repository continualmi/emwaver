//
//  EMWaverApp.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import EMWaverScriptRuntime

@main
struct EMWaverApp: App {
    init() {
        EnvBootstrap.loadForDevIfAvailable()
    }
    @StateObject private var device = MacUSBManager()
    @StateObject private var firmwareUpdater = FirmwareUpdateManager()
    @StateObject private var auth = AuthenticationManager()
    @StateObject private var hostSessions = HostSessionManager()
    @StateObject private var hostDirectory = HostDirectory()
    @StateObject private var remoteControlHost = RemoteControlHostService()
    @StateObject private var deviceRegistry = DeviceRegistryService()
    @StateObject private var previewManager = ScriptPreviewManager()
    @StateObject private var entitlements = EntitlementsManager()

    var body: some Scene {
        WindowGroup {
            ContentView(device: device, firmwareUpdater: firmwareUpdater, hostSessions: hostSessions, hostDirectory: hostDirectory, remoteControlHost: remoteControlHost, previewManager: previewManager)
                .environmentObject(auth)
                .environmentObject(entitlements)
                .sheet(isPresented: $firmwareUpdater.isPresented) {
                    FirmwareUpdateSheet(device: device, updater: firmwareUpdater)
                }
                .task {
                    // Best-effort background heartbeat + host discovery.
                    hostSessions.start(auth: auth, device: device)
                    hostDirectory.start(auth: auth)

                    // Remote control host WS (web can attach + drive scripts/UI).
                    remoteControlHost.start(auth: auth, device: device, hostSessions: hostSessions, previewManager: previewManager)

                    // Device identity -> backend attach (or prompt sign-in).
                    deviceRegistry.start(auth: auth, device: device)

                    // Pro entitlements/eligibility.
                    await entitlements.refresh(auth: auth, force: true)
                }
        }
        .commands {
            CommandMenu("Account") {
                if auth.isSignedIn {
                    Button("Sign Out") {
                        Task { await auth.signOut() }
                    }
                } else {
                    Button("Sign In…") {
                        auth.isSignInSheetPresented = true
                    }
                    .disabled(!auth.canSignInWithGoogle)
                }
            }

            CommandMenu("Device") {
                if device.isConnected {
                    Text("Status: Connected")
                        .foregroundStyle(.secondary)
                } else if firmwareUpdater.dfuConnected {
                    Text("Status: Update Mode")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Status: Disconnected")
                        .foregroundStyle(.secondary)
                }

                Divider()

                Button("Refresh Ports") {
                    device.refreshPorts()
                }

                Divider()

                Toggle("Auto-connect", isOn: $device.autoConnectEnabled)

                Menu("Connect") {
                    if device.availablePorts.isEmpty {
                        Text("No ports")
                    } else {
                        ForEach(device.availablePorts, id: \.self) { port in
                            Button {
                                device.connect(portName: port)
                            } label: {
                                if port == device.connectedPortName, device.isConnected {
                                    Label(port, systemImage: "checkmark")
                                } else {
                                    Text(port)
                                }
                            }
                        }
                    }
                }

                Button("Disconnect") {
                    device.disconnect()
                }
                .disabled(!device.isConnected)

                Divider()

                Button("Update Firmware…") {
                    firmwareUpdater.present()
                }

                if device.isConnected {
                    Button("Enter Update Mode") {
                        device.requestEnterUpdateMode()
                        device.disconnect()
                        firmwareUpdater.refreshDfuPresence()
                    }
                }

                Button("Refresh Update Mode") {
                    firmwareUpdater.refreshDfuPresence()
                }

                if firmwareUpdater.dfuConnected {
                    Text("Update Mode: Detected")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Update Mode: Not detected")
                        .foregroundStyle(.secondary)
                }

                if let err = device.lastErrorText, !err.isEmpty {
                    Divider()
                    Text(err)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
        }
    }
}

/// Loads repo env files for local development (no Xcode scheme env required).
/// Best-effort only; does not override already-set process env values.
private enum EnvBootstrap {
    static func loadForDevIfAvailable() {
        let fm = FileManager.default
        let start = URL(fileURLWithPath: fm.currentDirectoryPath, isDirectory: true)

        guard let repoRoot = findRepoRoot(from: start) else { return }

        let files = [
            "secrets/shared/core.env",
            "secrets/shared/firebase.env",
            "secrets/shared/oauth.env",
            "secrets/targets/apps.env",
        ]

        var resolved: [String: String] = [:]

        for rel in files {
            let p = repoRoot.appendingPathComponent(rel)
            guard let text = try? String(contentsOf: p, encoding: .utf8) else { continue }
            for rawLine in text.split(whereSeparator: \.isNewline) {
                let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
                if line.isEmpty || line.hasPrefix("#") { continue }
                guard let eq = line.firstIndex(of: "=") else { continue }

                let key = String(line[..<eq]).trimmingCharacters(in: .whitespacesAndNewlines)
                var val = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if key.isEmpty { continue }

                val = expand(val, resolved: resolved)

                if ProcessInfo.processInfo.environment[key] == nil, resolved[key] == nil {
                    setenv(key, val, 0)
                    resolved[key] = val
                } else if resolved[key] == nil {
                    resolved[key] = ProcessInfo.processInfo.environment[key] ?? val
                }
            }
        }
    }

    private static func expand(_ input: String, resolved: [String: String]) -> String {
        var out = input
        guard let regex = try? NSRegularExpression(pattern: #"\$\{([A-Z0-9_]+)\}"#) else { return out }

        for _ in 0..<4 {
            let ns = out as NSString
            let matches = regex.matches(in: out, range: NSRange(location: 0, length: ns.length))
            if matches.isEmpty { break }

            var next = out
            for m in matches.reversed() {
                guard m.numberOfRanges == 2 else { continue }
                let full = ns.substring(with: m.range(at: 0))
                let key = ns.substring(with: m.range(at: 1))
                let repl = resolved[key] ?? ProcessInfo.processInfo.environment[key] ?? ""
                next = (next as NSString).replacingOccurrences(of: full, with: repl, options: [], range: m.range(at: 0))
            }
            out = next
        }
        return out
    }

    private static func findRepoRoot(from start: URL) -> URL? {
        let fm = FileManager.default
        var current: URL? = start
        while let c = current {
            if fm.fileExists(atPath: c.appendingPathComponent("secrets/shared/core.env").path) {
                return c
            }
            let parent = c.deletingLastPathComponent()
            current = (parent.path == c.path) ? nil : parent
        }
        return nil
    }
}
