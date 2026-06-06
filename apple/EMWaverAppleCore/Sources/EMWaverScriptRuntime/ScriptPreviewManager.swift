/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import SwiftUI
import EMWaverScriptModel

@MainActor
public final class ScriptPreviewManager: ObservableObject {
    public struct Dialog: Identifiable {
        public let id = UUID()
        public let title: String
        public let message: String
    }

    @Published public var isPreviewVisible = false
    @Published public var isRendering = false
    @Published public var scriptTree: ScriptTree?
    @Published public var scriptError: String?
    @Published public private(set) var consoleLines: [String] = []
    @Published public var dialog: Dialog?
    @Published public var activeScriptName: String?
    @Published public var activeScriptInstanceId: String?

    private weak var device: (any ScriptDevice)?
    private var scriptEngine: ScriptEngine?
    private let bootstrapSourceOverride: String?
    private let maxConsoleLines = 500
    private let consoleTimestampFormatter = ISO8601DateFormatter()

    public init(bootstrapSource: String? = nil) {
        self.bootstrapSourceOverride = bootstrapSource
    }

    public func attach(device: (any ScriptDevice)?) {
        self.device = device
        registerBindings()
    }

    public func render(script: String, name: String?, moduleSources: [String: String]) {
        let trimmed = script.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        setupEngineIfNeeded()
        guard let engine = scriptEngine else { return }

        activeScriptName = name
        activeScriptInstanceId = UUID().uuidString
        isPreviewVisible = true
        isRendering = true
        scriptTree = nil
        scriptError = nil
        consoleLines.removeAll(keepingCapacity: true)

        engine.execute(script: trimmed, moduleSources: moduleSources) { [weak self] in
            guard let self else { return }
            self.isRendering = false
        }
    }

    /// Hide the preview UI while keeping the currently running script and its latest UI tree.
    ///
    /// This is important on macOS where users may want to keep a script running
    /// in the background while navigating elsewhere.
    public func hidePreview() {
        isPreviewVisible = false
        isRendering = false
        // Intentionally keep: scriptTree, scriptError, activeScriptName, activeScriptInstanceId
    }

    /// Stop/exit the current preview session (clears visible state).
    public func exitPreview() {
        stopScript()
        isPreviewVisible = false
        isRendering = false
        scriptTree = nil
        scriptError = nil
        consoleLines.removeAll(keepingCapacity: false)
        activeScriptName = nil
        activeScriptInstanceId = nil
    }

    /// Hard-stop the currently running script (best-effort): cancels timers and clears the JS context.
    public func stopScript() {
        scriptEngine?.reset()
        scriptEngine = nil
    }

    public var hasActiveScript: Bool { scriptEngine != nil }

    public func invoke(token: String, arguments: [Any]) {
        scriptEngine?.invoke(handler: token, arguments: arguments)
    }

    public func eval(_ code: String) async -> (output: [String], result: String?) {
        guard let engine = scriptEngine else { return (["[error] No script running"], nil) }
        return await engine.eval(code)
    }

    public func recordScriptError(_ message: String) {
        scriptError = message
        appendConsoleLine("[error] \(message)")
        isRendering = false
        isPreviewVisible = true
    }

    public func clearConsole() {
        consoleLines.removeAll(keepingCapacity: true)
    }

    private func setupEngineIfNeeded() {
        if scriptEngine != nil {
            registerBindings()
            return
        }

        let engine = ScriptEngine()
        if let bootstrapSourceOverride {
            engine.setBootstrapSource(bootstrapSourceOverride)
        }
        engine.consoleHandler = { [weak self] line in
            Task { @MainActor in
                self?.appendConsoleLine(line)
            }
        }
        engine.setup(
            renderHandler: { [weak self] tree in
                guard let self else { return }
                self.scriptTree = tree
                self.isRendering = false
                self.isPreviewVisible = true
            },
            bindings: buildBindings(),
            errorHandler: { [weak self] message in
                guard let self else { return }
                self.recordScriptError(message)
            }
        )
        scriptEngine = engine
    }

    private func appendConsoleLine(_ line: String) {
        let ts = consoleTimestampFormatter.string(from: Date())
        consoleLines.append("\(ts)  \(line)")
        if consoleLines.count > maxConsoleLines {
            consoleLines.removeFirst(consoleLines.count - maxConsoleLines)
        }
    }

    private func registerBindings() {
        let bindings = buildBindings()
        scriptEngine?.registerGlobalBindings(bindings)
    }

    private func buildBindings() -> [String: Any] {
        var bindings: [String: Any] = [:]
        if let device {
            bindings["Device"] = ScriptDeviceWrapper(device: device)
        }
        return bindings
    }
}
