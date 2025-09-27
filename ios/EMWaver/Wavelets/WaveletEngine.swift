import Foundation
import JavaScriptCore

final class WaveletEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.wavelet.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var globalBindings: [String: Any] = [:]
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

    private func injectDSL(into context: JSContext) {
        Swift.print("[WaveletEngine] Injecting DSL bundle")
        context.evaluateScript(Self.dslBootstrap)
        let uiType = context.evaluateScript("typeof UI")?.toString() ?? "undefined"
        Swift.print("[WaveletEngine] After inject typeof UI = \(uiType)")
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

private extension WaveletEngine {
    static let dslBootstrap = """
        'use strict';

        var WaveletBridge = typeof WaveletBridge !== 'undefined' ? WaveletBridge : {
            render(node) {
                _waveletRender(node);
            },
            registerCallback(token, fn) {
                if (typeof fn === 'function') {
                    _waveletRegisterCallback(token, fn);
                }
            },
            log(message) {
                var text = String(message);
                if (typeof WaveletConsole !== 'undefined' && WaveletConsole && typeof WaveletConsole.append === 'function') {
                    WaveletConsole.append(text);
                }
                _waveletPrint(text);
            }
        };

        if (typeof WaveletConsole === 'undefined') {
            var WaveletConsole = (function () {
                var lines = [];
                var subscribers = [];
                var limit = 500;

                var notify = function () {
                    for (var i = 0; i < subscribers.length; i += 1) {
                        try {
                            subscribers[i](lines.slice());
                        } catch (err) {
                            // ignore subscriber errors
                        }
                    }
                };

                var trim = function () {
                    if (lines.length > limit) {
                        lines.splice(0, lines.length - limit);
                    }
                };

                var api = {
                    setLimit: function (value) {
                        if (typeof value === 'number' && value > 0) {
                            limit = value;
                            trim();
                        }
                        return limit;
                    },
                    append: function (message) {
                        lines.push(String(message));
                        trim();
                        notify();
                    },
                    clear: function () {
                        lines.length = 0;
                        notify();
                    },
                    subscribe: function (fn) {
                        if (typeof fn !== 'function') {
                            return function () {};
                        }
                        subscribers.push(fn);
                        try {
                            fn(lines.slice());
                        } catch (err) {
                            // ignore initial subscriber error
                        }
                        return function () {
                            var index = subscribers.indexOf(fn);
                            if (index >= 0) {
                                subscribers.splice(index, 1);
                            }
                        };
                    },
                    lines: function () {
                        return lines.slice();
                    },
                    text: function () {
                        return lines.join('\\n');
                    },
                    view: function (props) {
                        var assigned = props ? Object.assign({}, props) : {};
                        assigned.text = api.text();
                        return UI.logViewer(assigned);
                    }
                };

                return api;
            })();
        }

        if (typeof print === 'undefined') {
            var print = function () {
                var parts = [];
                for (var i = 0; i < arguments.length; i += 1) {
                    var arg = arguments[i];
                    if (typeof arg === 'string') {
                        parts.push(arg);
                    } else {
                        try {
                            parts.push(JSON.stringify(arg));
                        } catch (e) {
                            parts.push(String(arg));
                        }
                    }
                }
                WaveletBridge.log(parts.join(' '));
            };
        }

        if (typeof console === 'undefined') {
            var console = {};
        }

        if (typeof console.log !== 'function') {
            console.log = function () {
                print.apply(null, arguments);
            };
        }

        if (typeof console.warn !== 'function') {
            console.warn = function () {
                print.apply(null, arguments);
            };
        }

        if (typeof console.error !== 'function') {
            console.error = function () {
                print.apply(null, arguments);
            };
        }

        if (typeof createByteArray === 'undefined') {
            var createByteArray = function (jsArray) {
                return _waveletCreateByteArray(jsArray);
            };
        }

        if (typeof dialog === 'undefined') {
            var dialog = function (title, message) {
                _waveletShowDialog(String(title || ''), String(message || ''));
            };
        }

        // Ensure BLEService.sendCommand is available
        if (typeof BLEService !== 'undefined' && typeof BLEService.sendCommand === 'undefined') {
            if (typeof _manualSendCommand === 'function') {
                BLEService.sendCommand = _manualSendCommand;
            }
        }

        if (typeof UI === 'undefined') {
            var UI = (function () {
                var idCounter = 0;

                var ensureId = function (type, props) {
                    if (props && typeof props.id === 'string' && props.id.length > 0) {
                        return props.id;
                    }
                    idCounter += 1;
                    return type + '_' + idCounter;
                };

                var normalizeProps = function (type, props) {
                    var assigned = props ? Object.assign({}, props) : {};
                    var children = Array.isArray(assigned.children) ? assigned.children : [];
                    delete assigned.children;
                    var id = ensureId(type, assigned);
                    assigned.id = id;
                    var cleanedChildren = [];
                    for (var i = 0; i < children.length; i += 1) {
                        var child = children[i];
                        if (child !== null && child !== undefined) {
                            cleanedChildren.push(child);
                        }
                    }
                    return { id: id, props: assigned, children: cleanedChildren };
                };

                var collectHandlers = function (id, props) {
                    var handlers = {};
                    var events = [
                        { key: 'onTap', type: 'tap' },
                        { key: 'onChange', type: 'change' },
                        { key: 'onSubmit', type: 'submit' }
                    ];
                    events.forEach(function (event) {
                        var fn = props[event.key];
                        if (typeof fn === 'function') {
                            var token = id + ':' + event.type;
                            WaveletBridge.registerCallback(token, fn);
                            handlers[event.type] = token;
                        }
                        if (props.hasOwnProperty(event.key)) {
                            delete props[event.key];
                        }
                    });
                    return handlers;
                };

                var makeNode = function (type, props) {
                    var normalized = normalizeProps(type, props);
                    var handlerTokens = collectHandlers(normalized.id, normalized.props);
                    return {
                        type: type,
                        id: normalized.id,
                        props: normalized.props,
                        children: normalized.children,
                        handlers: handlerTokens
                    };
                };

                return {
                    column: function (props) { return makeNode('column', props || {}); },
                    row: function (props) { return makeNode('row', props || {}); },
                    text: function (props) { return makeNode('text', props || {}); },
                    button: function (props) { return makeNode('button', props || {}); },
                    slider: function (props) { return makeNode('slider', props || {}); },
                    logViewer: function (props) { return makeNode('logViewer', props || {}); },
                    scroll: function (props) { return makeNode('scroll', props || {}); },
                    textField: function (props) { return makeNode('textField', props || {}); },
                    textEditor: function (props) { return makeNode('textEditor', props || {}); },
                    picker: function (props) { return makeNode('picker', props || {}); },
                    grid: function (props) { return makeNode('grid', props || {}); },
                    spacer: function (props) { return makeNode('spacer', props || {}); },
                    divider: function (props) { return makeNode('divider', props || {}); },
                    progress: function (props) { return makeNode('progress', props || {}); },
                    render: function (node) {
                        if (!node || typeof node !== 'object') {
                            WaveletBridge.log('UI.render called with invalid node');
                            return;
                        }
                        WaveletBridge.render(node);
                    }
                };
            })();
        }
    """
}
