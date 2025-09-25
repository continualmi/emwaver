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
            let context = JSContext()
            context?.exceptionHandler = { [weak self] _, exception in
                if let message = exception?.toString() {
                    self?.printHandler?("Wavelet error: \(message)")
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
            }

            self.context = context
        }
    }

    func execute(script: String, completion: (() -> Void)? = nil) {
        executionQueue.async { [weak self] in
            guard let self, let context = self.context else { return }
            self.callbackRegistry.removeAll()
            context.evaluateScript(script)
            if let completion {
                DispatchQueue.main.async {
                    completion()
                }
            }
        }
    }

    func invoke(handler token: String) {
        executionQueue.async { [weak self] in
            guard let self else { return }
            guard let callback = self.callbackRegistry[token] else {
                self.printHandler?("No callback registered for token \(token)")
                return
            }
            _ = callback.call(withArguments: [])
        }
    }

    private func injectDSL(into context: JSContext) {
        context.evaluateScript(Self.dslBootstrap)
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
        DispatchQueue.main.async {
            renderHandler(tree)
        }
    }

    private func buildNode(from value: JSValue) -> WaveletNode? {
        guard let typeString = value.forProperty("type")?.toString(),
              let nodeType = WaveletNodeType(rawValue: typeString) else {
            return nil
        }
        let id = value.forProperty("id")?.toString() ?? UUID().uuidString

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
                   let childNode = buildNode(from: childValue) {
                    childNodes.append(childNode)
                }
            }
        }

        let props = WaveletNodeProps(raw: rawProps, eventHandlers: eventHandlers)
        return WaveletNode(id: id, type: nodeType, props: props, children: childNodes)
    }
}

private extension WaveletEngine {
    static let dslBootstrap = """
        'use strict';

        const WaveletBridge = {
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

        const UI = (() => {
            let idCounter = 0;

            const ensureId = (type, props) => {
                if (props && typeof props.id === 'string' && props.id.length > 0) {
                    return props.id;
                }
                idCounter += 1;
                return `${type}_${idCounter}`;
            };

            const normalizeProps = (type, props) => {
                const assigned = props ? { ...props } : {};
                const children = Array.isArray(assigned.children) ? assigned.children : [];
                delete assigned.children;
                const id = ensureId(type, assigned);
                assigned.id = id;
                return { id, props: assigned, children };
            };

            const collectHandlers = (id, props) => {
                const handlers = {};
                if (typeof props.onTap === 'function') {
                    const token = `${id}:tap`;
                    WaveletBridge.registerCallback(token, props.onTap);
                    handlers.tap = token;
                }
                if (props.onTap !== undefined) {
                    delete props.onTap;
                }
                return handlers;
            };

            const makeNode = (type, props) => {
                const normalized = normalizeProps(type, props);
                const handlerTokens = collectHandlers(normalized.id, normalized.props);
                return {
                    type,
                    id: normalized.id,
                    props: normalized.props,
                    children: normalized.children,
                    handlers: handlerTokens
                };
            };

            return {
                column(props = {}) { return makeNode('column', props); },
                row(props = {}) { return makeNode('row', props); },
                text(props = {}) { return makeNode('text', props); },
                button(props = {}) { return makeNode('button', props); },
                slider(props = {}) { return makeNode('slider', props); },
                logViewer(props = {}) { return makeNode('logViewer', props); },
                render(node) {
                    if (!node || typeof node !== 'object') {
                        WaveletBridge.log('UI.render called with invalid node');
                        return;
                    }
                    WaveletBridge.render(node);
                }
            };
        })();
    """
}
