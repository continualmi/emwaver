/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
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
import EMWaverScriptModel

public final class ScriptEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.script.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var globalBindings: [String: Any] = [:]
    private var renderHandler: ((ScriptTree) -> Void)?
    private var errorHandler: ((String) -> Void)?

    // Timer support for `every()` (bootstrap uses setTimeout/clearTimeout).
    // Access only from executionQueue.
    private var nextTimeoutId: Int = 1
    private var timeouts: [Int: DispatchWorkItem] = [:]

    public init() {}

    private func emitError(_ message: String) {
        guard let errorHandler else { return }
        DispatchQueue.main.async {
            errorHandler(message)
        }
    }

    private func installHostPrimitives(into context: JSContext) {
        context.exceptionHandler = { [weak self] _, exception in
            if let message = exception?.toString() {
                self?.emitError("Script error: \(message)")
            }
        }

        let renderBlock: @convention(block) (JSValue) -> Void = { [weak self] value in
            self?.handleRender(nodeValue: value)
        }
        context.setObject(renderBlock, forKeyedSubscript: "_scriptRender" as NSString)

        let registerBlock: @convention(block) (String, JSValue) -> Void = { [weak self] token, callback in
            guard let self, !token.isEmpty else { return }
            self.callbackRegistry[token] = callback
        }
        context.setObject(registerBlock, forKeyedSubscript: "_scriptRegisterCallback" as NSString)

        let createByteArrayBlock: @convention(block) (JSValue) -> JSValue? = { jsArray in
            guard let context = jsArray.context else { return nil }
            guard jsArray.isArray else { return JSValue(undefinedIn: context) }
            let length = jsArray.forProperty("length")?.toInt32() ?? 0
            var bytes: [UInt8] = []
            bytes.reserveCapacity(Int(length))
            for i in 0..<length {
                if let element = jsArray.atIndex(Int(i)), element.isNumber {
                    bytes.append(UInt8(element.toInt32() & 0xFF))
                }
            }
            return JSValue(object: Data(bytes), in: context)
        }
        context.setObject(createByteArrayBlock, forKeyedSubscript: "_scriptCreateByteArray" as NSString)

        // Manual command helper (bridges to ScriptDeviceWrapper when present).
        let sendCommandBlock: @convention(block) (JSValue, JSValue) -> JSValue? = { [weak self] commandValue, timeoutValue in
            guard let self, let context = commandValue.context else { return nil }
            guard let wrapper = self.globalBindings["BLEService"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }
            guard let command = commandValue.toObject() as? Data, timeoutValue.isNumber else {
                return JSValue(nullIn: context)
            }
            let timeout = timeoutValue.toInt32()
            guard let result = wrapper.sendCommand(command, timeout: Int(timeout)) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendCommandBlock, forKeyedSubscript: "_manualSendCommand" as NSString)

        // Android parity: DeviceConnection.sendCommandString appends newline.
        let sendCommandStringBlock: @convention(block) (String, Int) -> JSValue? = { [weak self] command, timeout in
            guard let self else { return nil }
            guard let wrapper = self.globalBindings["BLEService"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }

            var framed = command
            if !framed.hasSuffix("\n") {
                framed += "\n"
            }
            guard let result = wrapper.sendCommand(Data(framed.utf8), timeout: timeout) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendCommandStringBlock, forKeyedSubscript: "_scriptSendCommandString" as NSString)

        // Byte-level packet variant.
        let sendPacketBlock: @convention(block) (JSValue, Int) -> JSValue? = { [weak self] bytesValue, timeout in
            guard let self else { return nil }
            guard let wrapper = self.globalBindings["BLEService"] as? ScriptDeviceWrapper else {
                return JSValue(nullIn: context)
            }
            guard let data = self.dataFromJSBytes(bytesValue) else { return JSValue(nullIn: context) }
            guard let result = wrapper.sendCommand(data, timeout: timeout) else {
                return JSValue(nullIn: context)
            }
            return JSValue(object: Array(result), in: context)
        }
        context.setObject(sendPacketBlock, forKeyedSubscript: "_scriptSendPacket" as NSString)

        // Blocking sleep primitive used by the sync-only bootstrap delay().
        let sleepBlock: @convention(block) (Double) -> Void = { ms in
            let durationMs = max(0.0, ms)
            if durationMs <= 0 { return }
            Thread.sleep(forTimeInterval: durationMs / 1000.0)
        }
        context.setObject(sleepBlock, forKeyedSubscript: "_scriptSleep" as NSString)

        // Minimal timer API used by every(): setTimeout/clearTimeout.
        let setTimeoutBlock: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            guard let self else { return 0 }
            let delayMs = max(0.0, ms)
            let id = self.nextTimeoutId
            self.nextTimeoutId += 1

            var item: DispatchWorkItem!
            item = DispatchWorkItem { [weak self] in
                guard let self else { return }
                if item.isCancelled { return }
                self.timeouts[id] = nil
                _ = callback.call(withArguments: [])
            }

            self.timeouts[id] = item
            let deadline = DispatchTime.now() + .milliseconds(Int(delayMs.rounded()))
            self.executionQueue.asyncAfter(deadline: deadline, execute: item)
            return id
        }
        context.setObject(setTimeoutBlock, forKeyedSubscript: "setTimeout" as NSString)

        let clearTimeoutBlock: @convention(block) (Int) -> Void = { [weak self] id in
            guard let self else { return }
            if let item = self.timeouts[id] {
                item.cancel()
                self.timeouts[id] = nil
            }
        }
        context.setObject(clearTimeoutBlock, forKeyedSubscript: "clearTimeout" as NSString)
    }

    private func dataFromJSBytes(_ bytesValue: JSValue) -> Data? {
        if let direct = bytesValue.toObject() as? Data {
            return direct
        }

        // JS arrays or typed arrays (Uint8Array etc.) are "array-like": they have a numeric `length`
        // and indexable elements. JavaScriptCore's `isArray` is false for typed arrays.
        let lengthValue = bytesValue.forProperty("length")
        guard let lengthValue, lengthValue.isNumber else { return nil }

        let length = Int(lengthValue.toInt32())
        if length <= 0 { return Data() }

        var bytes: [UInt8] = []
        bytes.reserveCapacity(length)
        for i in 0..<length {
            guard let element = bytesValue.atIndex(i), element.isNumber else { return nil }
            bytes.append(UInt8(element.toInt32() & 0xFF))
        }
        return Data(bytes)
    }

    public func setup(
        renderHandler: @escaping (ScriptTree) -> Void,
        bindings: [String: Any] = [:],
        errorHandler: ((String) -> Void)? = nil
    ) {
        self.renderHandler = renderHandler
        self.errorHandler = errorHandler
        self.globalBindings = bindings

        executionQueue.sync {
            guard let context = JSContext() else { return }
            self.installHostPrimitives(into: context)
            self.injectDSL(into: context)
            self.applyGlobalBindings(to: context)
            self.context = context
        }
    }

    public func execute(script: String, completion: (() -> Void)? = nil) {
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }

            self.cancelAllTimeoutsLocked()
            if self.containsAsyncTokens(script) {
                self.emitError("Script error: async/await is not supported. Scripts must be synchronous.")
                if let completion {
                    DispatchQueue.main.async { completion() }
                }
                return
            }

            self.callbackRegistry.removeAll()
            // Bootstrap hides host primitives (e.g. `_scriptSendPacket`) after capturing them.
            // Re-install on each run so re-injecting bootstrap continues to work.
            self.installHostPrimitives(into: context)
            self.injectDSL(into: context)
            self.applyGlobalBindings(to: context)

            context.exception = nil
            let wrappedScript = """
(() => {
\(script)
})();
"""
            context.evaluateScript(wrappedScript)

            if let completion {
                DispatchQueue.main.async { completion() }
            }
        }
    }

    public func invoke(handler token: String, arguments: [Any] = []) {
        executionQueue.async { [weak self] in
            guard let self else { return }
            guard let callback = self.callbackRegistry[token] else {
                self.emitError("No callback registered for token \(token)")
                return
            }
            _ = callback.call(withArguments: arguments)
        }
    }

    public func registerGlobalBindings(_ bindings: [String: Any]) {
        globalBindings.merge(bindings) { _, new in new }
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }
            self.applyGlobalBindings(to: context)
        }
    }

    private func cancelAllTimeoutsLocked() {
        // executionQueue only.
        for (_, item) in timeouts {
            item.cancel()
        }
        timeouts.removeAll()
    }

    private func containsAsyncTokens(_ script: String) -> Bool {
        // Intentionally simple: reject if any async/await tokens are present.
        // This may false-positive on strings/comments, but keeps behavior aligned across platforms.
        script.contains("await") || script.contains("async")
    }

    private func injectDSL(into context: JSContext) {
        guard let url = Bundle.main.url(forResource: "script_bootstrap", withExtension: "emw") else {
            emitError("Script bootstrap missing from app bundle (script_bootstrap.emw)")
            return
        }

        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            context.evaluateScript(source)
        } catch {
            emitError("Failed to load script bootstrap: \(error)")
        }
    }

    private func applyGlobalBindings(to context: JSContext) {
        for (key, value) in globalBindings {
            context.setObject(value, forKeyedSubscript: key as NSString)
        }
    }

    private func handleRender(nodeValue: JSValue) {
        guard let renderHandler else { return }
        guard let rootNode = buildNode(from: nodeValue) else {
            emitError("Script render received invalid node")
            return
        }

        let metadataValue = nodeValue.forProperty("metadata")
        var metadata: [String: Any] = [:]
        if metadataValue?.isUndefined == false,
           let dict = metadataValue?.toDictionary() as? [String: Any] {
            metadata = dict
        }

        let tree = ScriptTree(root: rootNode, metadata: metadata)
        DispatchQueue.main.async { renderHandler(tree) }
    }

    private func buildNode(from value: JSValue, path: [Int] = []) -> ScriptNode? {
        guard let typeString = value.forProperty("type")?.toString(),
              let nodeType = ScriptNodeType(rawValue: typeString) else {
            return nil
        }

        let rawId = value.forProperty("id")?.toString() ?? ""
        let id = makeStableIdentifier(rawId: rawId, nodeType: nodeType, path: path)

        var rawProps: [String: Any] = [:]
        if let propsDict = value.forProperty("props")?.toDictionary() as? [String: Any] {
            rawProps = propsDict
        }

        var eventHandlers: [ScriptEventType: String] = [:]
        if let handlerDict = value.forProperty("handlers")?.toDictionary() as? [String: Any] {
            for (key, rawValue) in handlerDict {
                guard let token = rawValue as? String,
                      let eventType = ScriptEventType(rawValue: key) else {
                    continue
                }
                eventHandlers[eventType] = token
            }
        }

        var childNodes: [ScriptNode] = []
        if let childrenValue = value.forProperty("children"), childrenValue.isArray {
            let count = childrenValue.forProperty("length")?.toInt32() ?? 0
            for index in 0..<count {
                if let childValue = childrenValue.atIndex(Int(index)),
                   let childNode = buildNode(from: childValue, path: path + [Int(index)]) {
                    childNodes.append(childNode)
                }
            }
        }

        let props = ScriptNodeProps(raw: rawProps, eventHandlers: eventHandlers)
        return ScriptNode(id: id, type: nodeType, props: props, children: childNodes)
    }

    private func makeStableIdentifier(rawId: String, nodeType: ScriptNodeType, path: [Int]) -> String {
        if !rawId.isEmpty && !isAutogeneratedId(rawId, for: nodeType) {
            return rawId
        }
        let pathComponent = path.map(String.init).joined(separator: "-")
        let suffix = pathComponent.isEmpty ? "root" : pathComponent
        return "\(nodeType.rawValue)-\(suffix)"
    }

    private func isAutogeneratedId(_ id: String, for nodeType: ScriptNodeType) -> Bool {
        let prefix = "\(nodeType.rawValue)_"
        guard id.hasPrefix(prefix) else { return false }
        let suffix = id.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy { $0.isNumber }
    }
}
