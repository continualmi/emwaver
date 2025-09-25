import Foundation
import JavaScriptCore

final class WaveletEngine {
    private let executionQueue = DispatchQueue(label: "com.emwaver.wavelet.engine")
    private var context: JSContext?
    private var callbackRegistry: [String: JSValue] = [:]
    private var printHandler: ((String) -> Void)?
    private var renderHandler: ((WaveletTree) -> Void)?

    init() {}

    func setup(printHandler: @escaping (String) -> Void,
               renderHandler: @escaping (WaveletTree) -> Void) {
        self.printHandler = printHandler
        self.renderHandler = renderHandler
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

            if let context {
                injectDSL(into: context)
                Swift.print("[WaveletEngine] DSL injected during setup")
            }

            self.context = context
            Swift.print("[WaveletEngine] Setup finished: context assigned = \(self.context != nil)")
        }
    }

    func execute(script: String, completion: (() -> Void)? = nil) {
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }
            self.callbackRegistry.removeAll()
            Swift.print("[WaveletEngine] execute(script:) reloading DSL before evaluation")
            self.injectDSL(into: context)
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

    private func injectDSL(into context: JSContext) {
        Swift.print("[WaveletEngine] Injecting DSL bundle")
        context.evaluateScript(Self.dslBootstrap)
        let uiType = context.evaluateScript("typeof UI")?.toString() ?? "undefined"
        Swift.print("[WaveletEngine] After inject typeof UI = \(uiType)")
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
        Swift.print("[WaveletEngine] handleRender with root type \(rootNode.type.rawValue)")
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
                _waveletPrint(String(message));
            }
        };

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
                    return { id: id, props: assigned, children: children };
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
