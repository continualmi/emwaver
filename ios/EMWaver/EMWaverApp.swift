/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import SwiftUI

@main
struct EMWaverApp: App {
    init() {
        EnvBootstrap.loadForDevIfAvailable()
    }

    @StateObject private var bleManager = USBManager()
    @StateObject private var hostSessions = HostSessionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(bleManager)
                .environmentObject(hostSessions)
        }
    }
}

/// Loads repo env files for local development (no Xcode scheme env required).
private enum EnvBootstrap {
    private static let requiredEnvMarker = ".env"

    static func loadForDevIfAvailable() {
        if ProcessInfo.processInfo.environment["EMWAVER_DISABLE_ENV_BOOTSTRAP"] == "1" {
            return
        }
#if DEBUG
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

                if ProcessInfo.processInfo.environment[key] == nil, resolved[key] == nil {
                    setenv(key, val, 0)
                    resolved[key] = val
                } else if resolved[key] == nil {
                    resolved[key] = ProcessInfo.processInfo.environment[key] ?? val
                }
            }
        }
#endif
    }

    private static func findRepoRoot() -> URL? {
        let sourceAnchor = URL(fileURLWithPath: #filePath, isDirectory: false).deletingLastPathComponent()
        if let repoRoot = findRepoRoot(from: sourceAnchor, maxDepth: 12) {
            return repoRoot
        }

        let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        return findRepoRoot(from: cwd, maxDepth: 16)
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

    private static func findRepoRoot(from start: URL, maxDepth: Int) -> URL? {
        let fm = FileManager.default
        var current: URL? = start.standardizedFileURL
        var steps = 0

        while let c = current, steps <= maxDepth {
            if fm.fileExists(atPath: c.appendingPathComponent(requiredEnvMarker).path) {
                return c
            }
            let parent = c.deletingLastPathComponent()
            current = (parent.path == c.path) ? nil : parent
            steps += 1
        }
        return nil
    }
}
