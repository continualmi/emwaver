package com.emwaver.emwaverandroidapp.wavelets;

import android.os.Handler;
import android.os.Looper;

import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.Wrapper;
import org.mozilla.javascript.RhinoException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class WaveletEngine {
    public interface PrintCallback {
        void onPrint(String message);
    }

    public interface RenderCallback {
        void onRender(WaveletTree tree);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "WaveletEngine");
        thread.setDaemon(true);
        return thread;
    });
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, Function> callbackRegistry = new ConcurrentHashMap<>();
    private final Map<String, Object> globalBindings = new ConcurrentHashMap<>();

    private volatile Scriptable scope;
    private volatile boolean initialized;

    public interface DialogCallback {
        void showDialog(String title, String message);
    }

    private PrintCallback printCallback;
    private RenderCallback renderCallback;
    private DialogCallback dialogCallback;

    public void setDialogCallback(DialogCallback dialogCallback) {
        this.dialogCallback = dialogCallback;
    }

    public void setup(PrintCallback printCallback, RenderCallback renderCallback, Map<String, Object> bindings) {
        this.printCallback = printCallback;
        this.renderCallback = renderCallback;
        globalBindings.clear();
        if (bindings != null && !bindings.isEmpty()) {
            globalBindings.putAll(bindings);
        }

        CountDownLatch latch = new CountDownLatch(1);
        executor.execute(() -> {
            Context cx = Context.enter();
            try {
                cx.setOptimizationLevel(-1);
                cx.setLanguageVersion(Context.VERSION_ES6);
                ScriptableObject newScope = cx.initStandardObjects();
                installBridge(newScope);
                applyGlobalBindings(cx, newScope);
                scope = newScope;
                initialized = true;
            } finally {
                Context.exit();
                latch.countDown();
            }
        });

        try {
            latch.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public void setup(PrintCallback printCallback, RenderCallback renderCallback) {
        setup(printCallback, renderCallback, Collections.emptyMap());
    }

    public void execute(String script, Runnable completion) {
        executor.execute(() -> {
            Context cx = Context.enter();
            try {
                cx.setOptimizationLevel(-1);
                cx.setLanguageVersion(Context.VERSION_ES6);
                ensureScope(cx);
                callbackRegistry.clear();
                injectDsl(cx, scope);

                String wrapped = "(function() {\n" + script + "\n})();";
                try {
                    cx.evaluateString(scope, wrapped, "WaveletScript", 1, null);
                } catch (RhinoException ex) {
                    dispatchPrint("Wavelet error: " + ex.getMessage());
                }
            } finally {
                Context.exit();
                if (completion != null) {
                    mainHandler.post(completion);
                }
            }
        });
    }

    public void invoke(String token, List<Object> arguments) {
        if (token == null || token.isEmpty()) {
            return;
        }
        executor.execute(() -> {
            android.util.Log.d("WaveletEngine", "invoke requested for token=" + token + " args=" + arguments);
            Function function = callbackRegistry.get(token);
            if (function == null) {
                dispatchPrint("No callback registered for token " + token);
                return;
            }
            Context cx = Context.enter();
            try {
                cx.setOptimizationLevel(-1);
                cx.setLanguageVersion(Context.VERSION_ES6);
                ensureScope(cx);
                Object[] jsArgs = convertArguments(cx, arguments);
                android.util.Log.d("WaveletEngine", "calling JS function for token=" + token);
                function.call(cx, scope, scope, jsArgs);
            } catch (RhinoException ex) {
                dispatchPrint("Wavelet callback error: " + ex.getMessage());
            } finally {
                Context.exit();
            }
        });
    }

    public void shutdown() {
        executor.shutdownNow();
    }

    public void registerGlobalBinding(String name, Object value) {
        Objects.requireNonNull(name, "name");
        if (value == null) {
            globalBindings.remove(name);
        } else {
            globalBindings.put(name, value);
        }
        executor.execute(() -> {
            Context cx = Context.enter();
            try {
                ensureScope(cx);
                if (scope != null) {
                    if (value == null) {
                        ScriptableObject.deleteProperty(scope, name);
                    } else {
                        ScriptableObject.putProperty(scope, name, Context.javaToJS(value, scope));
                    }
                }
            } finally {
                Context.exit();
            }
        });
    }

    public void registerGlobalBindings(Map<String, Object> bindings) {
        if (bindings == null || bindings.isEmpty()) {
            return;
        }
        for (Map.Entry<String, Object> entry : bindings.entrySet()) {
            registerGlobalBinding(entry.getKey(), entry.getValue());
        }
    }

    private void ensureScope(Context cx) {
        cx.setLanguageVersion(Context.VERSION_ES6);
        if (!initialized || scope == null) {
            ScriptableObject newScope = cx.initStandardObjects();
            installBridge(newScope);
            applyGlobalBindings(cx, newScope);
            scope = newScope;
            initialized = true;
        }
    }

    private void applyGlobalBindings(Context cx, Scriptable target) {
        if (target == null || globalBindings.isEmpty()) {
            return;
        }
        for (Map.Entry<String, Object> entry : globalBindings.entrySet()) {
            Object value = entry.getValue();
            if (value != null) {
                ScriptableObject.putProperty(target, entry.getKey(), Context.javaToJS(value, target));
            }
        }
    }

    private void installBridge(Scriptable scope) {
        ScriptableObject.putProperty(scope, "_waveletPrint", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length > 0) {
                    dispatchPrint(String.valueOf(args[0]));
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_waveletRender", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0 || !(args[0] instanceof Scriptable)) {
                    dispatchPrint("Wavelet render called with invalid node");
                    return Context.getUndefinedValue();
                }
                WaveletTree tree = buildTreeFromJs((Scriptable) args[0]);
                if (tree != null) {
                    dispatchRender(tree);
                } else {
                    dispatchPrint("Wavelet render received malformed node");
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_waveletRegisterCallback", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2) {
                    return Context.getUndefinedValue();
                }
                Object tokenObj = args[0];
                Object fnObj = args[1];
                if (tokenObj == null || !(fnObj instanceof Function)) {
                    return Context.getUndefinedValue();
                }
                String token = String.valueOf(tokenObj);
                Function fn = (Function) fnObj;
                if (!token.isEmpty()) {
                    android.util.Log.d("WaveletEngine", "registering callback token=" + token);
                    callbackRegistry.put(token, fn);
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_waveletShowDialog", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2) {
                    return Context.getUndefinedValue();
                }
                String title = String.valueOf(args[0]);
                String message = String.valueOf(args[1]);
                
                if (dialogCallback != null) {
                    mainHandler.post(() -> dialogCallback.showDialog(title, message));
                }
                
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_waveletCreateByteArray", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                
                Object arrayArg = args[0];
                if (arrayArg instanceof NativeArray) {
                    NativeArray jsArray = (NativeArray) arrayArg;
                    int length = (int) jsArray.getLength();
                    byte[] byteArray = new byte[length];
                    
                    for (int i = 0; i < length; i++) {
                        Object element = jsArray.get(i, jsArray);
                        if (element instanceof Number) {
                            byteArray[i] = ((Number) element).byteValue();
                        }
                    }
                    
                    return Context.javaToJS(byteArray, scope);
                }
                
                return Context.getUndefinedValue();
            }
        });
    }

    private void injectDsl(Context cx, Scriptable scope) {
        cx.evaluateString(scope, DSL_BOOTSTRAP, "WaveletDSL", 1, null);
    }

    private Object[] convertArguments(Context cx, List<Object> arguments) {
        if (arguments == null || arguments.isEmpty()) {
            return Context.emptyArgs;
        }
        Object[] converted = new Object[arguments.size()];
        for (int i = 0; i < arguments.size(); i++) {
            Object value = arguments.get(i);
            converted[i] = Context.javaToJS(value, scope);
        }
        return converted;
    }

    private WaveletTree buildTreeFromJs(Scriptable value) {
        WaveletNode node = buildNode(value, Collections.emptyList());
        if (node == null) {
            return null;
        }
        Map<String, Object> metadata = extractMetadata(value);
        return new WaveletTree(node, metadata);
    }

    private WaveletNode buildNode(Scriptable value, List<Integer> path) {
        Object typeObj = ScriptableObject.getProperty(value, "type");
        if (!(typeObj instanceof String)) {
            return null;
        }
        WaveletNodeType type = WaveletNodeType.fromRaw((String) typeObj);
        if (type == null) {
            return null;
        }

        String rawId = stringProperty(value, "id");
        String stableId = makeStableIdentifier(rawId, type, path);

        Map<String, Object> rawProps = extractProps(value);
        Map<WaveletEventType, String> handlers = extractHandlers(value, stableId, type);
        if (!handlers.isEmpty()) {
            rawProps = attachHandlerMetadata(rawProps, handlers);
        }
        WaveletNodeProps props = new WaveletNodeProps(rawProps, handlers);

        List<WaveletNode> children = extractChildren(value, path, type);

        return new WaveletNode(stableId, type, props, children);
    }

    private Map<String, Object> extractProps(Scriptable value) {
        Object propsObj = ScriptableObject.getProperty(value, "props");
        if (propsObj instanceof Scriptable) {
            return toJavaMap((Scriptable) propsObj);
        }
        return new HashMap<>();
    }

    private Map<String, Object> attachHandlerMetadata(Map<String, Object> props, Map<WaveletEventType, String> handlers) {
        if (props == null || props.isEmpty() || handlers == null || handlers.isEmpty()) {
            return props;
        }
        Map<String, Object> extended = new HashMap<>(props);
        Map<String, String> serialized = new HashMap<>();
        for (Map.Entry<WaveletEventType, String> entry : handlers.entrySet()) {
            serialized.put(entry.getKey().getRawValue(), entry.getValue());
        }
        extended.put(WaveletNodeProps.HANDLER_METADATA_KEY, serialized);
        return extended;
    }

    private Map<WaveletEventType, String> extractHandlers(Scriptable value, String nodeId, WaveletNodeType type) {
        Object handlersObj = ScriptableObject.getProperty(value, "handlers");
        if (!(handlersObj instanceof Scriptable)) {
            return Collections.emptyMap();
        }
        Scriptable scriptable = (Scriptable) handlersObj;
        Object[] ids = scriptable.getIds();
        if (ids.length == 0) {
            return Collections.emptyMap();
        }
        Map<WaveletEventType, String> handlers = new HashMap<>();
        for (Object id : ids) {
            Object rawValue = scriptable.get(id instanceof String ? (String) id : String.valueOf(id), scriptable);
            if (rawValue != null) {
                String eventKey = String.valueOf(id);
                String handlerToken = String.valueOf(rawValue);
                WaveletEventType eventType = WaveletEventType.fromRaw(eventKey);
                if (eventType != null) {
                    handlers.put(eventType, handlerToken);
                }
            }
        }
        return handlers;
    }

    private List<WaveletNode> extractChildren(Scriptable value, List<Integer> path, WaveletNodeType parentType) {
        Object childrenObj = ScriptableObject.getProperty(value, "children");
        if (!(childrenObj instanceof NativeArray)) {
            return Collections.emptyList();
        }
        NativeArray array = (NativeArray) childrenObj;
        int length = (int) array.getLength();
        List<WaveletNode> children = new ArrayList<>(length);
        for (int i = 0; i < length; i++) {
            Object child = array.get(i, array);
            if (child instanceof Scriptable) {
                List<Integer> nextPath = new ArrayList<>(path);
                nextPath.add(i);
                WaveletNode node = buildNode((Scriptable) child, nextPath);
                if (node != null) {
                    children.add(node);
                }
            }
        }
        return children;
    }

    private Map<String, Object> extractMetadata(Scriptable value) {
        Object metadataObj = ScriptableObject.getProperty(value, "metadata");
        if (metadataObj instanceof Scriptable) {
            return toJavaMap((Scriptable) metadataObj);
        }
        return new HashMap<>();
    }

    private String stringProperty(Scriptable value, String key) {
        Object raw = ScriptableObject.getProperty(value, key);
        if (raw == null || raw == Undefined.instance) {
            return null;
        }
        if (raw instanceof String) {
            return (String) raw;
        }
        return String.valueOf(raw);
    }

    private Map<String, Object> toJavaMap(Scriptable value) {
        Map<String, Object> map = new HashMap<>();
        for (Object id : value.getIds()) {
            String key = id instanceof String ? (String) id : String.valueOf(id);
            Object raw = value.get(key, value);
            map.put(key, convertValue(raw));
        }
        return map;
    }

    private List<Object> toJavaList(NativeArray array) {
        int length = (int) array.getLength();
        List<Object> list = new ArrayList<>(length);
        for (int i = 0; i < length; i++) {
            Object raw = array.get(i, array);
            list.add(convertValue(raw));
        }
        return list;
    }

    private Object convertValue(Object raw) {
        if (raw == null || raw == Undefined.instance) {
            return null;
        }
        if (raw instanceof Wrapper) {
            return ((Wrapper) raw).unwrap();
        }
        if (raw instanceof NativeArray) {
            return toJavaList((NativeArray) raw);
        }
        if (raw instanceof Scriptable) {
            return toJavaMap((Scriptable) raw);
        }
        if (raw instanceof Number || raw instanceof String || raw instanceof Boolean) {
            return raw;
        }
        return Context.jsToJava(raw, Object.class);
    }

    private String makeStableIdentifier(String rawId, WaveletNodeType type, List<Integer> path) {
        if (rawId != null && !rawId.isEmpty() && !isAutoGeneratedId(rawId, type)) {
            return rawId;
        }
        StringBuilder builder = new StringBuilder(type.getRawValue()).append('-');
        if (path.isEmpty()) {
            builder.append("root");
        } else {
            for (int i = 0; i < path.size(); i++) {
                if (i > 0) {
                    builder.append('-');
                }
                builder.append(path.get(i));
            }
        }
        return builder.toString();
    }

    private boolean isAutoGeneratedId(String rawId, WaveletNodeType type) {
        if (rawId == null) {
            return false;
        }
        String prefix = type.getRawValue() + "_";
        if (!rawId.startsWith(prefix)) {
            return false;
        }
        String suffix = rawId.substring(prefix.length());
        if (suffix.isEmpty()) {
            return false;
        }
        for (int i = 0; i < suffix.length(); i++) {
            if (!Character.isDigit(suffix.charAt(i))) {
                return false;
            }
        }
        return true;
    }

    private void dispatchPrint(String message) {
        if (printCallback == null) {
            return;
        }
        mainHandler.post(() -> printCallback.onPrint(message));
    }

    private void dispatchRender(WaveletTree tree) {
        if (renderCallback == null) {
            return;
        }
        mainHandler.post(() -> renderCallback.onRender(tree));
    }

    private static final String DSL_BOOTSTRAP =
        "'use strict';\n" +
        "\n" +
        "var WaveletBridge = typeof WaveletBridge !== 'undefined' ? WaveletBridge : {\n" +
        "    render: function (node) {\n" +
        "        _waveletRender(node);\n" +
        "    },\n" +
        "    registerCallback: function (token, fn) {\n" +
        "        if (typeof fn === 'function') {\n" +
        "            _waveletRegisterCallback(token, fn);\n" +
        "        }\n" +
        "    },\n" +
        "    log: function (message) {\n" +
        "        var text = String(message);\n" +
        "        if (typeof WaveletConsole !== 'undefined' && WaveletConsole && typeof WaveletConsole.append === 'function') {\n" +
        "            WaveletConsole.append(text);\n" +
        "        }\n" +
        "        _waveletPrint(text);\n" +
        "    }\n" +
        "};\n" +
        "\n" +
        "if (typeof WaveletConsole === 'undefined') {\n" +
        "    var WaveletConsole = (function () {\n" +
        "        var lines = [];\n" +
        "        var subscribers = [];\n" +
        "        var limit = 500;\n" +
        "\n" +
        "        var notify = function () {\n" +
        "            for (var i = 0; i < subscribers.length; i += 1) {\n" +
        "                try {\n" +
        "                    subscribers[i](lines.slice());\n" +
        "                } catch (err) {\n" +
        "                    // ignore subscriber errors\n" +
        "                }\n" +
        "            }\n" +
        "        };\n" +
        "\n" +
        "        var trim = function () {\n" +
        "            if (lines.length > limit) {\n" +
        "                lines.splice(0, lines.length - limit);\n" +
        "            }\n" +
        "        };\n" +
        "\n" +
        "        var api = {\n" +
        "            setLimit: function (value) {\n" +
        "                if (typeof value === 'number' && value > 0) {\n" +
        "                    limit = value;\n" +
        "                    trim();\n" +
        "                }\n" +
        "                return limit;\n" +
        "            },\n" +
        "            append: function (message) {\n" +
        "                lines.push(String(message));\n" +
        "                trim();\n" +
        "                notify();\n" +
        "            },\n" +
        "            clear: function () {\n" +
        "                lines.length = 0;\n" +
        "                notify();\n" +
        "            },\n" +
        "            subscribe: function (fn) {\n" +
        "                if (typeof fn !== 'function') {\n" +
        "                    return function () {};\n" +
        "                }\n" +
        "                subscribers.push(fn);\n" +
        "                try {\n" +
        "                    fn(lines.slice());\n" +
        "                } catch (err) {\n" +
        "                    // ignore initial subscriber error\n" +
        "                }\n" +
        "                return function () {\n" +
        "                    var index = subscribers.indexOf(fn);\n" +
        "                    if (index >= 0) {\n" +
        "                        subscribers.splice(index, 1);\n" +
        "                    }\n" +
        "                };\n" +
        "            },\n" +
        "            lines: function () {\n" +
        "                return lines.slice();\n" +
        "            },\n" +
        "            text: function () {\n" +
        "                return lines.join('\\n');\n" +
        "            },\n" +
        "            view: function (props) {\n" +
        "                var assigned = props ? Object.assign({}, props) : {};\n" +
        "                assigned.text = api.text();\n" +
        "                return UI.logViewer(assigned);\n" +
        "            }\n" +
        "        };\n" +
        "\n" +
        "        return api;\n" +
        "    })();\n" +
        "}\n" +
        "\n" +
        "if (typeof print === 'undefined') {\n" +
        "    var print = function () {\n" +
        "        var parts = [];\n" +
        "        for (var i = 0; i < arguments.length; i += 1) {\n" +
        "            var arg = arguments[i];\n" +
        "            if (typeof arg === 'string') {\n" +
        "                parts.push(arg);\n" +
        "            } else {\n" +
        "                try {\n" +
        "                    parts.push(JSON.stringify(arg));\n" +
        "                } catch (e) {\n" +
        "                    parts.push(String(arg));\n" +
        "                }\n" +
        "            }\n" +
        "        }\n" +
        "        WaveletBridge.log(parts.join(' '));\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof dialog === 'undefined') {\n" +
        "    var dialog = function (title, message) {\n" +
        "        _waveletShowDialog(String(title || ''), String(message || ''));\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof createByteArray === 'undefined') {\n" +
        "    var createByteArray = function (jsArray) {\n" +
        "        return _waveletCreateByteArray(jsArray);\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof console === 'undefined') {\n" +
        "    var console = {};\n" +
        "}\n" +
        "\n" +
        "if (typeof console.log !== 'function') {\n" +
        "    console.log = function () {\n" +
        "        print.apply(null, arguments);\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof console.warn !== 'function') {\n" +
        "    console.warn = function () {\n" +
        "        print.apply(null, arguments);\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof console.error !== 'function') {\n" +
        "    console.error = function () {\n" +
        "        print.apply(null, arguments);\n" +
        "    };\n" +
        "}\n" +
        "\n" +
        "if (typeof UI === 'undefined') {\n" +
        "    var UI = (function () {\n" +
        "        var idCounter = 0;\n" +
        "\n" +
        "        var ensureId = function (type, props) {\n" +
        "            if (props && typeof props.id === 'string' && props.id.length > 0) {\n" +
        "                return props.id;\n" +
        "            }\n" +
        "            idCounter += 1;\n" +
        "            return type + '_' + idCounter;\n" +
        "        };\n" +
        "\n" +
        "        var normalizeProps = function (type, props) {\n" +
        "            var assigned = props ? Object.assign({}, props) : {};\n" +
        "            var children = Array.isArray(assigned.children) ? assigned.children : [];\n" +
        "            delete assigned.children;\n" +
        "            var id = ensureId(type, assigned);\n" +
        "            assigned.id = id;\n" +
        "            var cleanedChildren = [];\n" +
        "            for (var i = 0; i < children.length; i += 1) {\n" +
        "                var child = children[i];\n" +
        "                if (child !== null && child !== undefined) {\n" +
        "                    cleanedChildren.push(child);\n" +
        "                }\n" +
        "            }\n" +
        "            return { id: id, props: assigned, children: cleanedChildren };\n" +
        "        };\n" +
        "\n" +
        "        var collectHandlers = function (id, props) {\n" +
        "            var handlers = {};\n" +
        "            var events = [\n" +
        "                { key: 'onTap', type: 'tap' },\n" +
        "                { key: 'onChange', type: 'change' },\n" +
        "                { key: 'onSubmit', type: 'submit' }\n" +
        "            ];\n" +
        "            events.forEach(function (event) {\n" +
        "                var fn = props[event.key];\n" +
        "                if (typeof fn === 'function') {\n" +
        "                    var token = id + ':' + event.type;\n" +
        "                    WaveletBridge.registerCallback(token, fn);\n" +
        "                    handlers[event.type] = token;\n" +
        "                }\n" +
        "                if (props.hasOwnProperty(event.key)) {\n" +
        "                    delete props[event.key];\n" +
        "                }\n" +
        "            });\n" +
        "            return handlers;\n" +
        "        };\n" +
        "\n" +
        "        var makeNode = function (type, props) {\n" +
        "            var normalized = normalizeProps(type, props);\n" +
        "            var handlerTokens = collectHandlers(normalized.id, normalized.props);\n" +
        "            return {\n" +
        "                type: type,\n" +
        "                id: normalized.id,\n" +
        "                props: normalized.props,\n" +
        "                children: normalized.children,\n" +
        "                handlers: handlerTokens\n" +
        "            };\n" +
        "        };\n" +
        "\n" +
        "        return {\n" +
        "            column: function (props) { return makeNode('column', props || {}); },\n" +
        "            row: function (props) { return makeNode('row', props || {}); },\n" +
        "            text: function (props) { return makeNode('text', props || {}); },\n" +
        "            button: function (props) { return makeNode('button', props || {}); },\n" +
        "            slider: function (props) { return makeNode('slider', props || {}); },\n" +
        "            logViewer: function (props) { return makeNode('logViewer', props || {}); },\n" +
        "            scroll: function (props) { return makeNode('scroll', props || {}); },\n" +
        "            textField: function (props) { return makeNode('textField', props || {}); },\n" +
        "            textEditor: function (props) { return makeNode('textEditor', props || {}); },\n" +
        "            picker: function (props) { return makeNode('picker', props || {}); },\n" +
        "            grid: function (props) { return makeNode('grid', props || {}); },\n" +
        "            spacer: function (props) { return makeNode('spacer', props || {}); },\n" +
        "            divider: function (props) { return makeNode('divider', props || {}); },\n" +
        "            progress: function (props) { return makeNode('progress', props || {}); },\n" +
        "            render: function (node) {\n" +
        "                if (!node || typeof node !== 'object') {\n" +
        "                    WaveletBridge.log('UI.render called with invalid node');\n" +
        "                    return;\n" +
        "                }\n" +
        "                WaveletBridge.render(node);\n" +
        "            }\n" +
        "        };\n" +
        "    })();\n" +
        "}\n";
}
