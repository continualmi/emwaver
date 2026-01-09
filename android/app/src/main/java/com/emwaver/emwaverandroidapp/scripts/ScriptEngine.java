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

package com.emwaver.emwaverandroidapp.scripts;

import android.os.Handler;
import android.os.Looper;

import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.EvaluatorException;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.mozilla.javascript.Wrapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ScriptEngine {
    public interface PrintCallback {
        void onPrint(String message);
    }

    public interface RenderCallback {
        void onRender(ScriptTree tree);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "ScriptEngine");
        thread.setDaemon(true);
        return thread;
    });
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, Function> callbackRegistry = new ConcurrentHashMap<>();
    private final Map<String, Object> globalBindings = new ConcurrentHashMap<>();
    private final Map<String, ModuleSource> moduleSources = new ConcurrentHashMap<>();
    private final Map<String, Object> moduleCache = new ConcurrentHashMap<>();
    private final ThreadLocal<Set<String>> moduleLoadingStack = ThreadLocal.withInitial(HashSet::new);

    private volatile Scriptable scope;
    private volatile boolean initialized;
    private volatile String bootstrapSource = "";

    public interface DialogCallback {
        void showDialog(String title, String message);
    }

    private PrintCallback printCallback;
    private RenderCallback renderCallback;
    private DialogCallback dialogCallback;

    public void setBootstrapSource(String source) {
        bootstrapSource = source != null ? source : "";
    }

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
                moduleLoadingStack.get().clear();

                String wrapped = "(function() {\n" + script + "\n})();";
                try {
                    cx.evaluateString(scope, wrapped, "ScriptScript", 1, null);
                } catch (RhinoException ex) {
                    String summary = "Script error: " + formatRhinoException(ex);
                    dispatchPrint(summary);
                    dispatchDialog("Script Error", summary + "\n\n" + fullRhinoTrace(ex));
                } catch (Exception ex) {
                    String summary = "Script error: " + ex.getMessage();
                    dispatchPrint(summary);
                    dispatchDialog("Script Error", summary + "\n\n" + android.util.Log.getStackTraceString(ex));
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
            android.util.Log.d("ScriptEngine", "invoke requested for token=" + token + " args=" + arguments);
            Function function = callbackRegistry.get(token);
            if (function == null) {
                String message = "No callback registered for token " + token;
                dispatchPrint(message);
                return;
            }
            Context cx = Context.enter();
            try {
                cx.setOptimizationLevel(-1);
                cx.setLanguageVersion(Context.VERSION_ES6);
                ensureScope(cx);
                Object[] jsArgs = convertArguments(cx, arguments);
                android.util.Log.d("ScriptEngine", "calling JS function for token=" + token);
                function.call(cx, scope, scope, jsArgs);
            } catch (RhinoException ex) {
                String summary = "Script callback error: " + formatRhinoException(ex);
                dispatchPrint(summary);
                dispatchDialog("Script Error", summary + "\n\n" + fullRhinoTrace(ex));
            } catch (Exception ex) {
                String summary = "Script callback error: " + ex.getMessage();
                dispatchPrint(summary);
                dispatchDialog("Script Error", summary + "\n\n" + android.util.Log.getStackTraceString(ex));
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

    public void updateModuleSources(Map<String, String> sources) {
        Map<String, ModuleSource> prepared = new HashMap<>();
        if (sources != null) {
            for (Map.Entry<String, String> entry : sources.entrySet()) {
                String name = entry.getKey();
                if (name == null) {
                    continue;
                }
                String normalized = normalizeModuleName(name);
                if (normalized.isEmpty()) {
                    continue;
                }
                String content = entry.getValue() != null ? entry.getValue() : "";
                prepared.put(normalized, new ModuleSource(name, content));
            }
        }

        executor.execute(() -> {
            moduleSources.clear();
            moduleSources.putAll(prepared);
            moduleCache.clear();
            moduleLoadingStack.get().clear();
            Context cx = Context.enter();
            try {
                ensureScope(cx);
                if (scope != null) {
                    ScriptableObject.deleteProperty(scope, "ScriptModules");
                    ScriptableObject.deleteProperty(scope, "require");
                }
            } finally {
                Context.exit();
            }
        });
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
        ScriptableObject.putProperty(scope, "_scriptPrint", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length > 0) {
                    String message = String.valueOf(args[0]);
                    dispatchPrint(message);
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptRender", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0 || !(args[0] instanceof Scriptable)) {
                    String message = "Script render called with invalid node";
                    dispatchPrint(message);
                    return Context.getUndefinedValue();
                }
                ScriptTree tree = buildTreeFromJs((Scriptable) args[0]);
                if (tree != null) {
                    dispatchRender(tree);
                } else {
                    String message = "Script render received malformed node";
                    dispatchPrint(message);
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptRegisterCallback", new BaseFunction() {
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
                    android.util.Log.d("ScriptEngine", "registering callback token=" + token);
                    callbackRegistry.put(token, fn);
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptShowDialog", new BaseFunction() {
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

        ScriptableObject.putProperty(scope, "_scriptCreateByteArray", new BaseFunction() {
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

        ScriptableObject.putProperty(scope, "_scriptImportModule", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0 || args[0] == null) {
                    return Context.getUndefinedValue();
                }
                return importModule(cx, String.valueOf(args[0]));
            }
        });
    }

    private void injectDsl(Context cx, Scriptable scope) {
        String source = bootstrapSource;
        if (source == null || source.trim().isEmpty()) {
            throw new EvaluatorException("Script bootstrap not loaded (missing script_bootstrap.js)");
        }
        cx.evaluateString(scope, source, "ScriptBootstrap", 1, null);
    }

    private Object importModule(Context cx, String rawName) {
        if (rawName == null) {
            return Context.getUndefinedValue();
        }
        String normalized = normalizeModuleName(rawName);
        if (normalized.isEmpty()) {
            throw new EvaluatorException("Module name is required");
        }
        ModuleSource source = moduleSources.get(normalized);
        if (source == null) {
            throw new EvaluatorException("Module '" + rawName + "' not found");
        }
        Object cached = moduleCache.get(normalized);
        if (cached != null) {
            return cached;
        }

        Set<String> loading = moduleLoadingStack.get();
        if (loading.contains(normalized)) {
            throw new EvaluatorException("Circular module dependency detected for '" + source.name + "'");
        }

        loading.add(normalized);
        try {
            ensureScope(cx);
            String wrapped = "(function(exports, module, ScriptModules, require) {\n" + source.content + "\n})";
            Object evaluated = cx.evaluateString(scope, wrapped, source.name, 1, null);
            if (!(evaluated instanceof Function)) {
                throw new EvaluatorException("Module '" + source.name + "' did not evaluate to a function");
            }

            Function factory = (Function) evaluated;
            Scriptable moduleScope = cx.newObject(scope);
            moduleScope.setPrototype(scope);
            moduleScope.setParentScope(scope);

            Scriptable exportsObject = cx.newObject(scope);
            Scriptable moduleObject = cx.newObject(scope);
            ScriptableObject.putProperty(moduleObject, "exports", exportsObject);
            ScriptableObject.putProperty(moduleObject, "id", source.name);
            ScriptableObject.putProperty(moduleObject, "filename", source.name);

            Function requireFunction = new BaseFunction() {
                @Override
                public Object call(Context innerCx, Scriptable innerScope, Scriptable thisObj, Object[] args) {
                    if (args.length == 0 || args[0] == null) {
                        return Context.getUndefinedValue();
                    }
                    return importModule(innerCx, String.valueOf(args[0]));
                }
            };

            Object library = scope != null ? scope.get("ScriptModules", scope) : Scriptable.NOT_FOUND;

            factory.call(
                cx,
                moduleScope,
                moduleScope,
                new Object[]{
                    exportsObject,
                    moduleObject,
                    library != Scriptable.NOT_FOUND ? library : Context.getUndefinedValue(),
                    requireFunction
                }
            );

            Object exportsValue = ScriptableObject.getProperty(moduleObject, "exports");
            if (exportsValue == Scriptable.NOT_FOUND || exportsValue == null) {
                exportsValue = exportsObject;
            }
            moduleCache.put(normalized, exportsValue);
            return exportsValue;
        } catch (RhinoException ex) {
            String message = "Failed to load module '" + source.name + "': " + formatRhinoException(ex);
            dispatchPrint(message);
            throw ex;
        } catch (Exception ex) {
            String message = "Failed to load module '" + source.name + "': " + ex.getMessage();
            dispatchPrint(message);
            EvaluatorException evaluatorException = new EvaluatorException(message);
            evaluatorException.initCause(ex);
            throw evaluatorException;
        } finally {
            loading.remove(normalized);
        }
    }

    private String formatRhinoException(RhinoException ex) {
        StringBuilder builder = new StringBuilder();
        String rawMessage = ex.getMessage();
        builder.append(rawMessage != null ? rawMessage : ex.toString());

        String sourceName = ex.sourceName();
        int lineNumber = ex.lineNumber();
        int columnNumber = ex.columnNumber();
        if (sourceName != null && !sourceName.isEmpty() && lineNumber >= 0) {
            builder.append(" (").append(sourceName).append(':').append(lineNumber);
            if (columnNumber >= 0) {
                builder.append(':').append(columnNumber);
            }
            builder.append(')');
        }

        String lineSource = ex.lineSource();
        if (lineSource != null && !lineSource.isEmpty()) {
            builder.append("\n").append(lineSource.trim());
        }

        String stack = ex.getScriptStackTrace();
        if (stack != null && !stack.isEmpty()) {
            builder.append("\n").append(stack.trim());
        }

        return builder.toString();
    }

    private String fullRhinoTrace(RhinoException ex) {
        if (ex == null) {
            return "";
        }
        String trace = ex.getScriptStackTrace();
        if (trace == null || trace.trim().isEmpty()) {
            return ex.toString();
        }
        return trace.trim();
    }

    private void dispatchDialog(String title, String message) {
        if (dialogCallback == null) {
            return;
        }
        mainHandler.post(() -> dialogCallback.showDialog(title, message));
    }

    private String normalizeModuleName(String rawName) {
        if (rawName == null) {
            return "";
        }
        String trimmed = rawName.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        return trimmed
            .replaceFirst("^\\./", "")
            .replaceFirst("\\.(js|emw)$", "")
            .toLowerCase(Locale.ROOT);
    }

    private static final class ModuleSource {
        final String name;
        final String content;

        ModuleSource(String name, String content) {
            this.name = name;
            this.content = content != null ? content : "";
        }
    }

    private Object[] convertArguments(Context cx, List<Object> arguments) {
        if (arguments == null || arguments.isEmpty()) {
            return Context.emptyArgs;
        }
        Object[] converted = new Object[arguments.size()];
        for (int i = 0; i < arguments.size(); i++) {
            converted[i] = convertArgument(cx, arguments.get(i));
        }
        return converted;
    }

    private Object convertArgument(Context cx, Object value) {
        if (value == null) {
            return Context.getUndefinedValue();
        }
        if (value instanceof CharSequence) {
            return value.toString();
        }
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        if (value instanceof Boolean) {
            return value;
        }
        if (value instanceof List<?>) {
            List<?> list = (List<?>) value;
            Object[] items = new Object[list.size()];
            for (int i = 0; i < list.size(); i++) {
                items[i] = convertArgument(cx, list.get(i));
            }
            return cx.newArray(scope, items);
        }
        if (value instanceof Map<?, ?>) {
            @SuppressWarnings("unchecked")
            Map<Object, Object> map = (Map<Object, Object>) value;
            Scriptable object = cx.newObject(scope);
            for (Map.Entry<Object, Object> entry : map.entrySet()) {
                Object key = entry.getKey();
                if (key != null) {
                    ScriptableObject.putProperty(object, String.valueOf(key), convertArgument(cx, entry.getValue()));
                }
            }
            return object;
        }
        if (value.getClass().isArray()) {
            return Context.javaToJS(value, scope);
        }
        return Context.javaToJS(value, scope);
    }

    private ScriptTree buildTreeFromJs(Scriptable value) {
        ScriptNode node = buildNode(value, Collections.emptyList());
        if (node == null) {
            return null;
        }
        Map<String, Object> metadata = extractMetadata(value);
        return new ScriptTree(node, metadata);
    }

    private ScriptNode buildNode(Scriptable value, List<Integer> path) {
        Object typeObj = ScriptableObject.getProperty(value, "type");
        if (!(typeObj instanceof String)) {
            return null;
        }
        ScriptNodeType type = ScriptNodeType.fromRaw((String) typeObj);
        if (type == null) {
            return null;
        }

        String rawId = stringProperty(value, "id");
        String stableId = makeStableIdentifier(rawId, type, path);

        Map<String, Object> rawProps = extractProps(value);
        Map<ScriptEventType, String> handlers = extractHandlers(value, stableId, type);
        if (!handlers.isEmpty()) {
            rawProps = attachHandlerMetadata(rawProps, handlers);
        }
        ScriptNodeProps props = new ScriptNodeProps(rawProps, handlers);

        List<ScriptNode> children = extractChildren(value, path, type);

        return new ScriptNode(stableId, type, props, children);
    }

    private Map<String, Object> extractProps(Scriptable value) {
        Object propsObj = ScriptableObject.getProperty(value, "props");
        if (propsObj instanceof Scriptable) {
            return toJavaMap((Scriptable) propsObj);
        }
        return new HashMap<>();
    }

    private Map<String, Object> attachHandlerMetadata(Map<String, Object> props, Map<ScriptEventType, String> handlers) {
        if (props == null || props.isEmpty() || handlers == null || handlers.isEmpty()) {
            return props;
        }
        Map<String, Object> extended = new HashMap<>(props);
        Map<String, String> serialized = new HashMap<>();
        for (Map.Entry<ScriptEventType, String> entry : handlers.entrySet()) {
            serialized.put(entry.getKey().getRawValue(), entry.getValue());
        }
        extended.put(ScriptNodeProps.HANDLER_METADATA_KEY, serialized);
        return extended;
    }

    private Map<ScriptEventType, String> extractHandlers(Scriptable value, String nodeId, ScriptNodeType type) {
        Object handlersObj = ScriptableObject.getProperty(value, "handlers");
        if (!(handlersObj instanceof Scriptable)) {
            return Collections.emptyMap();
        }
        Scriptable scriptable = (Scriptable) handlersObj;
        Object[] ids = scriptable.getIds();
        if (ids.length == 0) {
            return Collections.emptyMap();
        }
        Map<ScriptEventType, String> handlers = new HashMap<>();
        for (Object id : ids) {
            Object rawValue = scriptable.get(id instanceof String ? (String) id : String.valueOf(id), scriptable);
            if (rawValue != null) {
                String eventKey = String.valueOf(id);
                String handlerToken = String.valueOf(rawValue);
                ScriptEventType eventType = ScriptEventType.fromRaw(eventKey);
                if (eventType != null) {
                    handlers.put(eventType, handlerToken);
                }
            }
        }
        return handlers;
    }

    private List<ScriptNode> extractChildren(Scriptable value, List<Integer> path, ScriptNodeType parentType) {
        Object childrenObj = ScriptableObject.getProperty(value, "children");
        if (!(childrenObj instanceof NativeArray)) {
            return Collections.emptyList();
        }
        NativeArray array = (NativeArray) childrenObj;
        int length = (int) array.getLength();
        List<ScriptNode> children = new ArrayList<>(length);
        for (int i = 0; i < length; i++) {
            Object child = array.get(i, array);
            if (child instanceof Scriptable) {
                List<Integer> nextPath = new ArrayList<>(path);
                nextPath.add(i);
                ScriptNode node = buildNode((Scriptable) child, nextPath);
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

    private String makeStableIdentifier(String rawId, ScriptNodeType type, List<Integer> path) {
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

    private boolean isAutoGeneratedId(String rawId, ScriptNodeType type) {
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

    private void dispatchRender(ScriptTree tree) {
        if (renderCallback == null) {
            return;
        }
        mainHandler.post(() -> renderCallback.onRender(tree));
    }

}
