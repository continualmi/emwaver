//
//  EMWaverApp.swift
//  EMWaver
//
//  Created by Luís Lopes on 1/29/26.
//

import SwiftUI
import Combine
import EMWaverScriptRuntime
#if canImport(AppKit)
import AppKit
#endif

@main
struct EMWaverApp: App {
    @State private var didActivateApp = false

    init() {
        EnvBootstrap.loadForDevIfAvailable()
    }
    @StateObject private var device = MacUSBManager()
    @StateObject private var firmwareUpdater = FirmwareUpdateManager()
    @StateObject private var auth = AuthenticationManager()
    @StateObject private var hostSessions = HostSessionManager()
    @StateObject private var previewManager = ScriptPreviewManager()
    @StateObject private var scriptSessions = MacScriptSessionManager()
    @StateObject private var appRouter = AppRouter()
    @StateObject private var appUpdater = MacAppUpdateController()

    var body: some Scene {
        WindowGroup {
            ContentView(device: device, firmwareUpdater: firmwareUpdater, hostSessions: hostSessions, scriptSessions: scriptSessions, previewManager: previewManager)
                .environmentObject(auth)
                .environmentObject(appRouter)
                .task {
                    await auth.waitForInitialRestore()
                }
                .onAppear {
                    activateAppIfNeeded()
                }
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    appUpdater.checkForUpdates()
                }
            }

            CommandMenu("Device") {
                if device.isConnected {
                    Text("Status: Connected")
                        .foregroundStyle(.secondary)
                } else if FirmwareUpdateManager.isEspBoardType(device.connectedBoardType ?? device.lastDetectedBoardType), firmwareUpdater.espBootloaderConnected {
                    Text("Status: ESP Bootloader")
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

                Button("Open Device…") {
                    appRouter.isDeviceSheetPresented = true
                }

                if device.isConnected {
                    Button("Enter Update Mode") {
                        let boardType = device.connectedBoardType ?? device.lastDetectedBoardType ?? "stm32f042"
                        if FirmwareUpdateManager.isEspBoardType(boardType) {
                            appRouter.isDeviceSheetPresented = true
                        } else {
                            device.requestEnterUpdateMode()
                            device.disconnect()
                            firmwareUpdater.refreshDfuPresence()
                        }
                    }
                }

                Button("Refresh Update Mode") {
                    firmwareUpdater.refreshDfuPresence(includeEspSerialProbe: true)
                }

                if FirmwareUpdateManager.isEspBoardType(device.connectedBoardType ?? device.lastDetectedBoardType), firmwareUpdater.espBootloaderConnected {
                    Text("ESP Bootloader: Detected")
                        .foregroundStyle(.secondary)
                } else if firmwareUpdater.dfuConnected {
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

    private func activateAppIfNeeded() {
        guard !didActivateApp else { return }
        didActivateApp = true
#if canImport(AppKit)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
#endif
    }
}

@MainActor
final class AppRouter: ObservableObject {
    @Published var isDeviceSheetPresented: Bool = false
}

/// Loads repo env files for local development (no Xcode scheme env required).
/// Best-effort only; does not override already-set process env values.
private enum EnvBootstrap {
    private static let requiredEnvMarker = ".env"

    static func loadForDevIfAvailable() {
        // Escape hatch for startup regressions while keeping auto-env for local dev.
        if ProcessInfo.processInfo.environment["EMWAVER_DISABLE_ENV_BOOTSTRAP"] == "1" {
            return
        }
#if !DEBUG
        return
#endif
        guard let repoRoot = findRepoRoot() else { return }

        let files = [".env"]

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

                setenv(key, val, 1)
                resolved[key] = val
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

    private static func findRepoRoot() -> URL? {
        // Prefer a deterministic source-file anchor so startup doesn't depend on Xcode run cwd.
        let sourceAnchor = URL(fileURLWithPath: #filePath, isDirectory: false).deletingLastPathComponent()
        if let r = findRepoRoot(from: sourceAnchor, maxDepth: 12) {
            return r
        }

        // Fallback for unusual layouts.
        let fm = FileManager.default
        let cwd = URL(fileURLWithPath: fm.currentDirectoryPath, isDirectory: true)
        return findRepoRoot(from: cwd, maxDepth: 16)
    }

    private static func findRepoRoot(from start: URL, maxDepth: Int) -> URL? {
        let fm = FileManager.default
        var current: URL? = start
        var depth = 0
        while let c = current, depth <= maxDepth {
            if fm.fileExists(atPath: c.appendingPathComponent(requiredEnvMarker).path) {
                return c
            }
            let parent = c.deletingLastPathComponent()
            current = (parent.path == c.path) ? nil : parent
            depth += 1
        }
        return nil
    }
}
