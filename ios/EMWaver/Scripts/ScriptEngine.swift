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

final class ScriptEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.script.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var globalBindings: [String: Any] = [:]
    private var printHandler: ((String) -> Void)?
    private var renderHandler: ((ScriptTree) -> Void)?
    // Legacy host dialog hook (not part of the public Script API).
    private var dialogHandler: ((String, String) -> Void)?

    init() {}

    func setup(printHandler: @escaping (String) -> Void,
               renderHandler: @escaping (ScriptTree) -> Void,
               bindings: [String: Any] = [:]) {
        self.printHandler = printHandler
        self.renderHandler = renderHandler
        self.globalBindings = bindings
        executionQueue.sync {
            Swift.print("[ScriptEngine] Setup requested")
            let context = JSContext()
            context?.exceptionHandler = { [weak self] _, exception in
                if let message = exception?.toString() {
                    self?.printHandler?("Script error: \(message)")
                    Swift.print("[ScriptEngine] JS exception: \(message)")
                }
            }

            let printBlock: @convention(block) (String) -> Void = { [weak self] message in
                self?.printHandler?(message)
            }
            context?.setObject(printBlock, forKeyedSubscript: "_scriptPrint" as NSString)

            let renderBlock: @convention(block) (JSValue) -> Void = { [weak self] value in
                self?.handleRender(nodeValue: value)
            }
            context?.setObject(renderBlock, forKeyedSubscript: "_scriptRender" as NSString)

            let registerBlock: @convention(block) (String, JSValue) -> Void = { [weak self] token, callback in
                guard let self = self, !token.isEmpty else { return }
                self.callbackRegistry[token] = callback
            }
            context?.setObject(registerBlock, forKeyedSubscript: "_scriptRegisterCallback" as NSString)

            let createByteArrayBlock: @convention(block) (JSValue) -> JSValue? = { [weak self] jsArray in
                guard let context = jsArray.context else { return nil }
                self?.printHandler?("[ScriptEngine] createByteArray called")
                
                if jsArray.isArray {
                    let length = jsArray.forProperty("length")?.toInt32() ?? 0
                    var bytes: [UInt8] = []
                    self?.printHandler?("[ScriptEngine] createByteArray input array length: \(length)")
                    
                    for i in 0..<length {
                        if let element = jsArray.atIndex(Int(i)),
                           element.isNumber {
                            let byte = UInt8(element.toInt32() & 0xFF)
                            bytes.append(byte)
                        }
                    }
                    
                    // Create a Data object that JavaScript can use
                    let data = Data(bytes)
                    self?.printHandler?("[ScriptEngine] createByteArray created Data with \(data.count) bytes: \(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
                    return JSValue(object: data, in: context)
                }
                
                self?.printHandler?("[ScriptEngine] createByteArray called with non-array")
                return JSValue(undefinedIn: context)
            }
            context?.setObject(createByteArrayBlock, forKeyedSubscript: "_scriptCreateByteArray" as NSString)

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
            context?.setObject(sendCommandStringBlock, forKeyedSubscript: "_scriptSendCommandString" as NSString)

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
            context?.setObject(sendPacketBlock, forKeyedSubscript: "_scriptSendPacket" as NSString)

            let dialogBlock: @convention(block) (String, String) -> Void = { [weak self] title, message in
                guard let self else { return }
                self.printHandler?("[ScriptEngine] dialog requested: \(title)")
                DispatchQueue.main.async {
                    self.dialogHandler?(title, message)
                }
            }
            context?.setObject(dialogBlock, forKeyedSubscript: "_scriptShowDialog" as NSString)

            if let context {
                injectDSL(into: context)
                applyGlobalBindings(to: context)
                Swift.print("[ScriptEngine] DSL injected during setup")
            }

            self.context = context
            Swift.print("[ScriptEngine] Setup finished: context assigned = \(self.context != nil)")
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
            
            // Check if BLEService is available after binding
            let bleServiceCheck = context.evaluateScript("typeof BLEService")?.toString() ?? "undefined"
            let sendCommandCheck = context.evaluateScript("typeof BLEService?.sendCommand")?.toString() ?? "undefined"
            self.printHandler?("DEBUG: After binding - typeof BLEService = \(bleServiceCheck)")
            self.printHandler?("DEBUG: After binding - typeof BLEService.sendCommand = \(sendCommandCheck)")
            
            context.exception = nil
            let wrappedScript = """
(() => {
\(script)
})();
"""
            Swift.print("[ScriptEngine] Evaluating script snippet: \(script.prefix(80))...")
            context.evaluateScript(wrappedScript)
            if let exception = context.exception?.toString(), !exception.isEmpty {
                Swift.print("[ScriptEngine] Evaluation exception: \(exception)")
            }
            if let completion {
                DispatchQueue.main.async {
                    Swift.print("[ScriptEngine] Completion callback dispatched")
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

    private func injectDSL(into context: JSContext) {
        Swift.print("[ScriptEngine] Injecting shared script bootstrap")
        guard let url = Bundle.main.url(forResource: "script_bootstrap", withExtension: "emw") else {
            let message = "Script bootstrap missing from app bundle (script_bootstrap.js)"
            printHandler?(message)
            Swift.print("[ScriptEngine] \(message)")
            return
        }

        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            context.evaluateScript(source)
            let uiType = context.evaluateScript("typeof UI")?.toString() ?? "undefined"
            Swift.print("[ScriptEngine] After inject typeof UI = \(uiType)")
        } catch {
            let message = "Failed to load script bootstrap: \(error)"
            printHandler?(message)
            Swift.print("[ScriptEngine] \(message)")
        }
    }

    private func applyGlobalBindings(to context: JSContext) {
        printHandler?("DEBUG: Applying \(globalBindings.count) global bindings...")
        for (key, value) in globalBindings {
            context.setObject(value, forKeyedSubscript: key as NSString)
            printHandler?("DEBUG: Applied binding \(key) = \(type(of: value))")
        }
    }

    private func handleRender(nodeValue: JSValue) {
        guard let renderHandler else { return }
        guard let rootNode = buildNode(from: nodeValue) else {
            printHandler?("Script render received invalid node")
            return
        }
        let metadataValue = nodeValue.forProperty("metadata")
        var metadata: [String: Any] = [:]
        if metadataValue?.isUndefined == false,
           let dict = metadataValue?.toDictionary() as? [String: Any] {
            metadata = dict
        }
        let tree = ScriptTree(root: rootNode, metadata: metadata)
        printHandler?("[ScriptEngine] handleRender with root type \(rootNode.type.rawValue)")
        DispatchQueue.main.async {
            renderHandler(tree)
        }
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
