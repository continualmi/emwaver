/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
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
    @Published public var dialog: Dialog?
    @Published public var activeScriptName: String?

    private weak var device: (any ScriptDevice)?
    private var scriptEngine: ScriptEngine?

    public init() {}

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
        isPreviewVisible = true
        isRendering = true
        scriptTree = nil
        scriptError = nil

        // TODO: support moduleSources import/require.
        engine.execute(script: trimmed) { [weak self] in
            guard let self else { return }
            self.isRendering = false
        }
    }

    public func exitPreview() {
        isPreviewVisible = false
        isRendering = false
        scriptTree = nil
        scriptError = nil
        activeScriptName = nil
    }

    public func invoke(token: String, arguments: [Any]) {
        scriptEngine?.invoke(handler: token, arguments: arguments)
    }

    private func setupEngineIfNeeded() {
        if scriptEngine != nil {
            registerBindings()
            return
        }

        let engine = ScriptEngine()
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
                self.scriptError = message
                self.isRendering = false
                self.isPreviewVisible = true
            }
        )
        scriptEngine = engine
    }

    private func registerBindings() {
        guard let engine = scriptEngine else { return }
        engine.registerGlobalBindings(buildBindings())
    }

    private func buildBindings() -> [String: Any] {
        var bindings: [String: Any] = [:]
        if let device {
            bindings["Device"] = ScriptDeviceWrapper(device: device)
        }
        return bindings
    }
}
