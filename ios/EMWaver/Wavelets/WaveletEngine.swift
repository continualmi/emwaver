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

final class WaveletEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.wavelet.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var globalBindings: [String: Any] = [:]
    private var moduleSources: [String: ModuleSource] = [:]
    private var moduleCache: [String: JSValue] = [:]
    private var moduleLoadingStack: Set<String> = []
    private var printHandler: ((String) -> Void)?
    private var renderHandler: ((WaveletTree) -> Void)?
    private var dialogHandler: ((String, String) -> Void)?

    init() {}

    func setup(printHandler: @escaping (String) -> Void,
               renderHandler: @escaping (WaveletTree) -> Void,
               dialogHandler: ((String, String) -> Void)? = nil,
               bindings: [String: Any] = [:]) {
        self.printHandler = printHandler
        self.renderHandler = renderHandler
        self.dialogHandler = dialogHandler
        self.globalBindings = bindings
        executionQueue.sync {
            Swift.print("[WaveletEngine] Setup requested")
            let context = JSContext()
            context?.exceptionHandler = { [weak self] _, exception in
                if let message = exception?.toString() {
                    self?.printHandler?("Wavelet error: \(message)")
                    Swift.print("[WaveletEngine] JS exception: \(message)")
                }
            }

            let printBlock: @convention(block) (String) -> Void = { [weak self] message in
                self?.printHandler?(message)
            }
            context?.setObject(printBlock, forKeyedSubscript: "_waveletPrint" as NSString)

            let renderBlock: @convention(block) (JSValue) -> Void = { [weak self] value in
                self?.handleRender(nodeValue: value)
            }
            context?.setObject(renderBlock, forKeyedSubscript: "_waveletRender" as NSString)

            let registerBlock: @convention(block) (String, JSValue) -> Void = { [weak self] token, callback in
                guard let self = self, !token.isEmpty else { return }
                self.callbackRegistry[token] = callback
            }
            context?.setObject(registerBlock, forKeyedSubscript: "_waveletRegisterCallback" as NSString)

            let importBlock: @convention(block) (String) -> JSValue? = { [weak self] moduleName in
                guard let self else { return nil }
                guard let activeContext = self.context ?? context else { return nil }
                return self.importModule(named: moduleName, context: activeContext)
            }
            context?.setObject(importBlock, forKeyedSubscript: "_waveletImportModule" as NSString)

            let createByteArrayBlock: @convention(block) (JSValue) -> JSValue? = { [weak self] jsArray in
                guard let context = jsArray.context else { return nil }
                self?.printHandler?("[WaveletEngine] createByteArray called")
                
                if jsArray.isArray {
                    let length = jsArray.forProperty("length")?.toInt32() ?? 0
                    var bytes: [UInt8] = []
                    self?.printHandler?("[WaveletEngine] createByteArray input array length: \(length)")
                    
                    for i in 0..<length {
                        if let element = jsArray.atIndex(Int(i)),
                           element.isNumber {
                            let byte = UInt8(element.toInt32() & 0xFF)
                            bytes.append(byte)
                        }
                    }
                    
                    // Create a Data object that JavaScript can use
                    let data = Data(bytes)
                    self?.printHandler?("[WaveletEngine] createByteArray created Data with \(data.count) bytes: \(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
                    return JSValue(object: data, in: context)
                }
                
                self?.printHandler?("[WaveletEngine] createByteArray called with non-array")
                return JSValue(undefinedIn: context)
            }
            context?.setObject(createByteArrayBlock, forKeyedSubscript: "_waveletCreateByteArray" as NSString)

            // Add manual BLEService.sendCommand method
            let sendCommandBlock: @convention(block) (JSValue, JSValue) -> JSValue? = { [weak self] commandValue, timeoutValue in
                guard let context = commandValue.context else { return nil }
                
                if let bleServiceWrapper = self?.globalBindings["BLEService"] as? BLEServiceWrapper,
                   let command = commandValue.toObject() as? Data,
                   timeoutValue.isNumber {
                    
                    let timeout = timeoutValue.toInt32()
                    self?.printHandler?("[BLEServiceWrapper] sendCommand called via manual block with \(command.count) bytes, timeout: \(timeout)")
                    
                    if let result = bleServiceWrapper.sendCommand(command, timeout: Int(timeout)) {
                        let bytes = Array(result)
                        self?.printHandler?("[BLEServiceWrapper] manual block returning \(bytes.count) bytes: \(bytes.map { String(format: "%02X", $0) }.joined(separator: " "))")
                        return JSValue(object: bytes, in: context)
                    }
                }
                
                return JSValue(nullIn: context)
            }
            context?.setObject(sendCommandBlock, forKeyedSubscript: "_manualSendCommand" as NSString)

            // Android parity: DeviceConnection.sendCommandString appends newline and defaults timeout to 2000ms.
            let sendCommandStringBlock: @convention(block) (String, Int) -> JSValue? = { [weak self] command, timeout in
                guard let context else { return nil }
                guard let bleServiceWrapper = self?.globalBindings["BLEService"] as? BLEServiceWrapper else {
                    return JSValue(nullIn: context)
                }

                var framed = command
                if !framed.hasSuffix("\n") {
                    framed += "\n"
                }

                let result = bleServiceWrapper.sendCommand(Data(framed.utf8), timeout: timeout)
                guard let result else { return JSValue(nullIn: context) }
                return JSValue(object: Array(result), in: context)
            }
            context?.setObject(sendCommandStringBlock, forKeyedSubscript: "_waveletSendCommandString" as NSString)

            // Byte-level command variant (used by DeviceConnection.sendPacket / emw.sendPacket).
            let sendPacketBlock: @convention(block) (JSValue, Int) -> JSValue? = { [weak self] bytesValue, timeout in
                guard let context else { return nil }
                guard let bleServiceWrapper = self?.globalBindings["BLEService"] as? BLEServiceWrapper else {
                    return JSValue(nullIn: context)
                }

                let data: Data?
                if let direct = bytesValue.toObject() as? Data {
                    data = direct
                } else if bytesValue.isArray {
                    let length = bytesValue.forProperty("length")?.toInt32() ?? 0
                    var bytes: [UInt8] = []
                    bytes.reserveCapacity(Int(length))
                    for i in 0..<length {
                        if let element = bytesValue.atIndex(Int(i)), element.isNumber {
                            bytes.append(UInt8(element.toInt32() & 0xFF))
                        }
                    }
                    data = Data(bytes)
                } else {
                    data = nil
                }

                guard let data else { return JSValue(nullIn: context) }
                let result = bleServiceWrapper.sendCommand(data, timeout: timeout)
                guard let result else { return JSValue(nullIn: context) }
                return JSValue(object: Array(result), in: context)
            }
            context?.setObject(sendPacketBlock, forKeyedSubscript: "_waveletSendPacket" as NSString)

            let dialogBlock: @convention(block) (String, String) -> Void = { [weak self] title, message in
                guard let self else { return }
                self.printHandler?("[WaveletEngine] dialog requested: \(title)")
                DispatchQueue.main.async {
                    self.dialogHandler?(title, message)
                }
            }
            context?.setObject(dialogBlock, forKeyedSubscript: "_waveletShowDialog" as NSString)

            if let context {
                injectDSL(into: context)
                applyGlobalBindings(to: context)
                Swift.print("[WaveletEngine] DSL injected during setup")
            }

            self.context = context
            Swift.print("[WaveletEngine] Setup finished: context assigned = \(self.context != nil)")
        }
    }

    func execute(script: String, completion: (() -> Void)? = nil) {
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { 
                return 
            }
            
            // Debug via print handler so it shows in UI
            self.printHandler?("DEBUG: execute() called with \(self.globalBindings.keys.count) bindings: \(Array(self.globalBindings.keys))")
            
            self.callbackRegistry.removeAll()
            self.injectDSL(into: context)
            self.applyGlobalBindings(to: context)  // Apply bindings again after DSL reload
            self.moduleLoadingStack.removeAll()
            
            // Check if BLEService is available after binding
            let bleServiceCheck = context.evaluateScript("typeof BLEService")?.toString() ?? "undefined"
            let sendCommandCheck = context.evaluateScript("typeof BLEService?.sendCommand")?.toString() ?? "undefined"
            let manualSendCommandCheck = context.evaluateScript("typeof _manualSendCommand")?.toString() ?? "undefined"
            self.printHandler?("DEBUG: After binding - typeof BLEService = \(bleServiceCheck)")
            self.printHandler?("DEBUG: After binding - typeof BLEService.sendCommand = \(sendCommandCheck)")
            self.printHandler?("DEBUG: After binding - typeof _manualSendCommand = \(manualSendCommandCheck)")
            
            context.exception = nil
            let wrappedScript = """
(() => {
\(script)
})();
"""
            Swift.print("[WaveletEngine] Evaluating script snippet: \(script.prefix(80))...")
            context.evaluateScript(wrappedScript)
            if let exception = context.exception?.toString(), !exception.isEmpty {
                Swift.print("[WaveletEngine] Evaluation exception: \(exception)")
            }
            if let completion {
                DispatchQueue.main.async {
                    Swift.print("[WaveletEngine] Completion callback dispatched")
                    completion()
                }
            }
        }
    }

    func invoke(handler token: String, arguments: [Any] = []) {
        executionQueue.async { [weak self] in
            guard let self else { return }
            guard let callback = self.callbackRegistry[token] else {
                self.printHandler?("No callback registered for token \(token)")
                return
            }
            _ = callback.call(withArguments: arguments)
        }
    }

    func registerGlobalBindings(_ bindings: [String: Any]) {
        globalBindings.merge(bindings) { _, new in new }
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }
            self.applyGlobalBindings(to: context)
        }
    }
    func updateModuleSources(_ sources: [String: String]) {
        executionQueue.async { [weak self] in
            guard let self else { return }
            var prepared: [String: ModuleSource] = [:]
            for (name, content) in sources {
                let normalized = self.normalizeModuleName(name)
                guard !normalized.isEmpty else { continue }
                prepared[normalized] = ModuleSource(name: name, content: content)
            }
            self.moduleSources = prepared
            self.moduleCache.removeAll()
            self.moduleLoadingStack.removeAll()
            if let context = self.context {
                context.setObject(nil, forKeyedSubscript: "WaveletModules" as NSString)
                context.setObject(nil, forKeyedSubscript: "require" as NSString)
            }
        }
    }

    private func injectDSL(into context: JSContext) {
        Swift.print("[WaveletEngine] Injecting shared wavelet bootstrap")
        guard let url = Bundle.main.url(forResource: "wavelet_bootstrap", withExtension: "emw") else {
            let message = "Wavelet bootstrap missing from app bundle (wavelet_bootstrap.emw)"
            printHandler?(message)
            Swift.print("[WaveletEngine] \(message)")
            return
        }

        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            context.evaluateScript(source)
            let uiType = context.evaluateScript("typeof UI")?.toString() ?? "undefined"
            Swift.print("[WaveletEngine] After inject typeof UI = \(uiType)")
        } catch {
            let message = "Failed to load wavelet bootstrap: \(error)"
            printHandler?(message)
            Swift.print("[WaveletEngine] \(message)")
        }
    }

    private func applyGlobalBindings(to context: JSContext) {
        printHandler?("DEBUG: Applying \(globalBindings.count) global bindings...")
        for (key, value) in globalBindings {
            context.setObject(value, forKeyedSubscript: key as NSString)
            printHandler?("DEBUG: Applied binding \(key) = \(type(of: value))")
        }
    }

    private func importModule(named rawName: String, context: JSContext) -> JSValue? {
        let normalized = normalizeModuleName(rawName)
        guard !normalized.isEmpty else {
            return moduleError("Module name is required", context: context)
        }
        guard let source = moduleSources[normalized] else {
            return moduleError("Module '\(rawName)' not found", context: context)
        }
        if let cached = moduleCache[normalized] {
            return cached
        }
        if moduleLoadingStack.contains(normalized) {
            return moduleError("Circular module dependency detected for '\(source.name)'", context: context)
        }

        moduleLoadingStack.insert(normalized)
        defer { moduleLoadingStack.remove(normalized) }

        let wrapped = "(function(exports, module, WaveletModules, require) {\n\(source.content)\n})"
        guard let factoryValue = context.evaluateScript(wrapped) else {
            if let exception = context.exception?.toString() {
                printHandler?("Failed to evaluate module '\(source.name)': \(exception)")
            }
            return moduleError("Module '\(source.name)' did not evaluate to a function", context: context)
        }
        guard factoryValue.isObject else {
            return moduleError("Module '\(source.name)' evaluation did not return a function", context: context)
        }
        guard let exportsObject = JSValue(newObjectIn: context),
              let moduleObject = JSValue(newObjectIn: context) else {
            return moduleError("Unable to allocate module scaffolding for '\(source.name)'", context: context)
        }
        moduleObject.setObject(exportsObject, forKeyedSubscript: "exports" as NSString)
        moduleObject.setObject(source.name, forKeyedSubscript: "id" as NSString)
        moduleObject.setObject(source.name, forKeyedSubscript: "filename" as NSString)

        let requireBlock: @convention(block) (String) -> JSValue? = { [weak self] moduleName in
            guard let self, let ctx = self.context else { return JSValue(undefinedIn: context) }
            return self.importModule(named: moduleName, context: ctx)
        }
        let requireValue = JSValue(object: requireBlock, in: context) ?? JSValue(undefinedIn: context)
        let waveletModules = context.objectForKeyedSubscript("WaveletModules") ?? JSValue(undefinedIn: context)

        _ = factoryValue.call(withArguments: [exportsObject, moduleObject, waveletModules, requireValue])

        if let exception = context.exception {
            let message = exception.toString() ?? "Unknown module error"
            printHandler?("Failed to load module '\(source.name)': \(message)")
            Swift.print("[WaveletEngine] Module exception: \(message)")
            return nil
        }

        let exportedValue = moduleObject.forProperty("exports") ?? exportsObject
        moduleCache[normalized] = exportedValue
        return exportedValue
    }

    private func normalizeModuleName(_ rawName: String) -> String {
        let trimmed = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return trimmed
            .replacingOccurrences(of: #"^\./"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\.(js|emw)$"#, with: "", options: .regularExpression)
            .lowercased()
    }

    private func moduleError(_ message: String, context: JSContext) -> JSValue? {
        let prefixed = "Module error: \(message)"
        printHandler?(prefixed)
        Swift.print("[WaveletEngine] \(prefixed)")
        if let error = JSValue(newErrorFromMessage: message, in: context) {
            context.exception = error
        }
        return nil
    }

    private struct ModuleSource {
        let name: String
        let content: String
    }

    private func handleRender(nodeValue: JSValue) {
        guard let renderHandler else { return }
        guard let rootNode = buildNode(from: nodeValue) else {
            printHandler?("Wavelet render received invalid node")
            return
        }
        let metadataValue = nodeValue.forProperty("metadata")
        var metadata: [String: Any] = [:]
        if metadataValue?.isUndefined == false,
           let dict = metadataValue?.toDictionary() as? [String: Any] {
            metadata = dict
        }
        let tree = WaveletTree(root: rootNode, metadata: metadata)
        printHandler?("[WaveletEngine] handleRender with root type \(rootNode.type.rawValue)")
        DispatchQueue.main.async {
            renderHandler(tree)
        }
    }

    private func buildNode(from value: JSValue, path: [Int] = []) -> WaveletNode? {
        guard let typeString = value.forProperty("type")?.toString(),
              let nodeType = WaveletNodeType(rawValue: typeString) else {
            return nil
        }
        let rawId = value.forProperty("id")?.toString() ?? ""
        let id = makeStableIdentifier(rawId: rawId, nodeType: nodeType, path: path)

        var rawProps: [String: Any] = [:]
        if let propsDict = value.forProperty("props")?.toDictionary() as? [String: Any] {
            rawProps = propsDict
        }

        var eventHandlers: [WaveletEventType: String] = [:]
        if let handlerDict = value.forProperty("handlers")?.toDictionary() as? [String: Any] {
            for (key, rawValue) in handlerDict {
                guard let token = rawValue as? String,
                      let eventType = WaveletEventType(rawValue: key) else {
                    continue
                }
                eventHandlers[eventType] = token
            }
        }

        var childNodes: [WaveletNode] = []
        if let childrenValue = value.forProperty("children"),
           childrenValue.isArray {
            let count = childrenValue.forProperty("length")?.toInt32() ?? 0
            for index in 0..<count {
                if let childValue = childrenValue.atIndex(Int(index)),
                   let childNode = buildNode(from: childValue, path: path + [Int(index)]) {
                    childNodes.append(childNode)
                }
            }
        }

        let props = WaveletNodeProps(raw: rawProps, eventHandlers: eventHandlers)
        return WaveletNode(id: id, type: nodeType, props: props, children: childNodes)
    }

    private func makeStableIdentifier(rawId: String, nodeType: WaveletNodeType, path: [Int]) -> String {
        if !rawId.isEmpty && !isAutogeneratedId(rawId, for: nodeType) {
            return rawId
        }

        let pathComponent = path.map(String.init).joined(separator: "-")
        let suffix = pathComponent.isEmpty ? "root" : pathComponent
        return "\(nodeType.rawValue)-\(suffix)"
    }

    private func isAutogeneratedId(_ id: String, for nodeType: WaveletNodeType) -> Bool {
        let prefix = "\(nodeType.rawValue)_"
        guard id.hasPrefix(prefix) else { return false }
        let suffix = id.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy { $0.isNumber }
    }
}
