/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import JavaScriptCore
import SwiftUI

@objc protocol BLEManagerJSExport: JSExport {
    func getBuffer() -> Data
    func clearBuffer()
    func loadBuffer(data: Data)
    func sendPacket(_ data: Data)
    func sendCommand(_ command: Data, timeout: Int) -> Data?
    func transmitBuffer()
}

@objc final class BLEServiceWrapper: NSObject, BLEManagerJSExport {
    private let bleManager: BLEManager

    init(bleManager: BLEManager) {
        self.bleManager = bleManager
        super.init()
    }

    func getBuffer() -> Data {
        bleManager.getBuffer()
    }

    func clearBuffer() {
        bleManager.clearBuffer()
    }

    func loadBuffer(data: Data) {
        bleManager.loadBuffer(data: data)
    }

    func sendPacket(_ data: Data) {
        bleManager.sendPacket(data)
    }

    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        bleManager.sendCommand(command, timeout: timeout)
    }

    func transmitBuffer() {
        bleManager.transmitBuffer()
    }
}

@MainActor
final class WaveletPreviewManager: ObservableObject {
    struct Dialog: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    @Published var isPreviewVisible = false
    @Published var isRendering = false
    @Published var waveletTree: WaveletTree?
    @Published var consoleLines: [String] = []
    @Published var dialog: Dialog?
    @Published var activeScriptName: String?

    private weak var bleManager: BLEManager?
    private var waveletEngine: WaveletEngine?
    private let consoleLimit = 500

    func attach(bleManager: BLEManager) {
        self.bleManager = bleManager
        registerBindings()
    }

    func updateConnectionState(isConnected: Bool) {
        guard bleManager != nil else { return }
        registerBindings()
    }

    func render(script: String, name: String?, moduleSources: [String: String]) {
        let trimmed = script.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        setupEngineIfNeeded()
        guard let engine = waveletEngine else { return }
        engine.updateModuleSources(moduleSources)

        activeScriptName = name
        isPreviewVisible = true
        isRendering = true
        waveletTree = nil
        clearConsole()

        engine.execute(script: trimmed) { [weak self] in
            guard let self else { return }
            self.isRendering = false
        }
    }

    func exitPreview() {
        isPreviewVisible = false
        isRendering = false
        waveletTree = nil
        activeScriptName = nil
    }

    func clearConsole() {
        consoleLines.removeAll()
    }

    func invoke(token: String, arguments: [Any]) {
        waveletEngine?.invoke(handler: token, arguments: arguments)
    }

    private func setupEngineIfNeeded() {
        if waveletEngine != nil {
            registerBindings()
            return
        }

        let engine = WaveletEngine()
        engine.setup(
            printHandler: { [weak self] message in
                guard let self else { return }
                Task { @MainActor in
                    self.appendLine(message)
                }
            },
            renderHandler: { [weak self] tree in
                guard let self else { return }
                self.waveletTree = tree
                self.isRendering = false
                self.isPreviewVisible = true
            },
            dialogHandler: { [weak self] title, message in
                guard let self else { return }
                self.dialog = Dialog(title: title.isEmpty ? "Wavelet" : title, message: message)
            },
            bindings: buildBindings()
        )
        waveletEngine = engine
    }

    private func registerBindings() {
        guard let engine = waveletEngine else { return }
        engine.registerGlobalBindings(buildBindings())
    }

    private func buildBindings() -> [String: Any] {
        var bindings: [String: Any] = [:]
        if let bleManager {
            bindings["BLEService"] = BLEServiceWrapper(bleManager: bleManager)
        }
        return bindings
    }

    private func appendLine(_ line: String) {
        consoleLines.append(line)
        if consoleLines.count > consoleLimit {
            consoleLines.removeFirst(consoleLines.count - consoleLimit)
        }
    }
}
