/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
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

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class ScriptEngine {
    public interface RenderCallback {
        void onRender(ScriptTree tree);
    }

    public interface ErrorCallback {
        void onError(String message);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "ScriptEngine");
        thread.setDaemon(true);
        return thread;
    });
    private final ScheduledExecutorService timerExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "ScriptEngineTimers");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicInteger nextTimeoutId = new AtomicInteger(1);
    private final Map<Integer, ScheduledFuture<?>> timeoutFutures = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, Function> callbackRegistry = new ConcurrentHashMap<>();
    private final Map<String, Object> globalBindings = new ConcurrentHashMap<>();
    private volatile ScriptDeviceBridge deviceConnection;

    private volatile Scriptable scope;
    private volatile boolean initialized;
    private volatile String bootstrapSource = "";
    private volatile Map<String, String> moduleSources = Collections.emptyMap();
    private volatile File appDataDir;
    private volatile List<File> legacySignalDirs = Collections.emptyList();
    private volatile byte[] samplerManualBuffer;

    private RenderCallback renderCallback;
    private ErrorCallback errorCallback;

    public void setBootstrapSource(String source) {
        bootstrapSource = source != null ? source : "";
    }

    public void setModuleSources(Map<String, String> sources) {
        if (sources == null || sources.isEmpty()) {
            moduleSources = Collections.emptyMap();
            return;
        }
        moduleSources = new HashMap<>(sources);
    }

    public void setDeviceConnection(ScriptDeviceBridge deviceConnection) {
        this.deviceConnection = deviceConnection;
    }

    public void setAppDataDir(File appDataDir) {
        this.appDataDir = appDataDir;
    }

    public void setLegacySignalDirs(List<File> legacyDirs) {
        if (legacyDirs == null || legacyDirs.isEmpty()) {
            this.legacySignalDirs = Collections.emptyList();
            return;
        }
        List<File> sanitized = new ArrayList<>();
        for (File d : legacyDirs) {
            if (d != null) {
                sanitized.add(d);
            }
        }
        this.legacySignalDirs = sanitized;
    }

    public void setup(RenderCallback renderCallback, Map<String, Object> bindings, ErrorCallback errorCallback) {
        this.renderCallback = renderCallback;
        this.errorCallback = errorCallback;
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

    public void setup(RenderCallback renderCallback, Map<String, Object> bindings) {
        setup(renderCallback, bindings, null);
    }

    public void execute(String script, Runnable completion) {
        execute(script, Collections.emptyMap(), completion);
    }

    public void execute(String script, Map<String, String> sources, Runnable completion) {
        setModuleSources(sources);
        executor.execute(() -> {
            Context cx = Context.enter();
            try {
                cx.setOptimizationLevel(-1);
                cx.setLanguageVersion(Context.VERSION_ES6);
                ensureScope(cx);
                // Bootstrap hides host primitives after capturing them.
                // Reinstall bridge functions before each run.
                installBridge(scope);
                applyGlobalBindings(cx, scope);
                callbackRegistry.clear();
                clearAllTimeouts();
                injectDsl(cx, scope);
                installRequire(cx, scope);

                if (containsAsyncTokens(script)) {
                    dispatchError("Script error: async/await is not supported. Scripts must be synchronous.");
                    return;
                }

                String transformed = ScriptSourceTranspiler.transpile(script);
                String wrapped = "(function() {\n" + transformed + "\n})();";
                try {
                    cx.evaluateString(scope, wrapped, "ScriptScript", 1, null);
                } catch (RhinoException ex) {
                    String summary = "Script error: " + formatRhinoException(ex);
                    dispatchError(summary);
                } catch (Exception ex) {
                    String summary = "Script error: " + ex.getMessage();
                    dispatchError(summary);
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
                dispatchError(message);
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
                dispatchError(summary);
            } catch (Exception ex) {
                String summary = "Script callback error: " + ex.getMessage();
                dispatchError(summary);
            } finally {
                Context.exit();
            }
        });
    }

    public void shutdown() {
        clearAllTimeouts();
        timerExecutor.shutdownNow();
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
        ScriptableObject.putProperty(scope, "_scriptRender", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                Scriptable rootNode = null;
                if (args.length > 0) {
                    if (args[0] instanceof Scriptable) {
                        rootNode = (Scriptable) args[0];
                    } else if (args[0] instanceof CharSequence) {
                        String json = String.valueOf(args[0]).trim();
                        if (!json.isEmpty()) {
                            try {
                                rootNode = parseJsonNode(cx, scope, json);
                            } catch (Exception ignored) {
                            }
                        }
                    }
                }

                if (rootNode == null) {
                    String message = "Script render called with invalid node";
                    dispatchError(message);
                    return Context.getUndefinedValue();
                }
                ScriptTree tree = buildTreeFromJs(rootNode);
                if (tree != null) {
                    dispatchRender(tree);
                } else {
                    String message = "Script render received malformed node";
                    dispatchError(message);
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

        // Byte-level command variant (used by emw.sendPacket / __emwSendPacket).
        ScriptableObject.putProperty(scope, "_scriptSendPacket", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                ScriptDeviceBridge connection = deviceConnection;
                if (connection == null || !connection.isConnected()) {
                    return null;
                }

                int timeoutMs = 2000;
                if (args.length >= 2 && args[1] instanceof Number) {
                    timeoutMs = Math.max(0, ((Number) args[1]).intValue());
                }

                byte[] payload = coerceToByteArray(args[0]);
                if (payload == null) {
                    return null;
                }

                byte[] response = connection.sendPacket(payload, timeoutMs);
                if (response == null) {
                    return null;
                }

                return toJsByteArray(cx, scope, response);
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSleep", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0) {
                    return Context.getUndefinedValue();
                }
                long ms = 0;
                Object obj = args[0];
                if (obj instanceof Number) {
                    ms = Math.max(0L, ((Number) obj).longValue());
                }
                try {
                    Thread.sleep(ms);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSamplerBufferGetPacketCount", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                byte[] data = readSamplerBytesSnapshot();
                if (data.length <= 0) {
                    return 0;
                }
                int packetSize = getSamplerPacketSizeBytes();
                return (data.length + packetSize - 1) / packetSize;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSamplerBufferGetLenBytes", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return readSamplerBytesSnapshot().length;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSamplerBufferGetBytes", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return toJsByteArray(cx, scope, readSamplerBytesSnapshot());
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSamplerBufferClear", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                samplerManualBuffer = null;
                ScriptDeviceBridge connection = deviceConnection;
                if (connection != null) {
                    connection.clearBuffer();
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptSamplerBufferReadPacketsSince", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                int packetIndex = 0;
                int maxPackets = 1;
                if (args.length >= 1 && args[0] instanceof Number) {
                    packetIndex = Math.max(0, ((Number) args[0]).intValue());
                }
                if (args.length >= 2 && args[1] instanceof Number) {
                    maxPackets = Math.max(1, ((Number) args[1]).intValue());
                }

                byte[] data = readSamplerBytesSnapshot();
                int packetSize = getSamplerPacketSizeBytes();
                int totalPackets = (data.length + packetSize - 1) / packetSize;
                int startPacket = Math.min(packetIndex, totalPackets);
                int availablePackets = Math.max(0, totalPackets - startPacket);
                int toRead = Math.max(0, Math.min(availablePackets, maxPackets));

                int startByte = startPacket * packetSize;
                int endByte = Math.min(data.length, startByte + toRead * packetSize);
                byte[] slice = endByte > startByte ? java.util.Arrays.copyOfRange(data, startByte, endByte) : new byte[0];

                Scriptable out = cx.newObject(scope);
                ScriptableObject.putProperty(out, "data", toJsByteArray(cx, scope, slice));
                ScriptableObject.putProperty(out, "nextPacketIndex", startPacket + toRead);
                ScriptableObject.putProperty(out, "availablePackets", availablePackets);
                return out;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptPlotBufferSet", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return "";
                }
                byte[] data = coerceToByteArray(args[0]);
                if (data == null) {
                    return "";
                }
                String id = "buf:" + UUID.randomUUID();
                ScriptPlotBufferStore.setBuffer(id, data);
                return id;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptBufferSetBytes", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return 0;
                }
                byte[] data = coerceToByteArray(args[0]);
                if (data == null) {
                    return 0;
                }
                ScriptDeviceBridge connection = deviceConnection;
                if (connection == null) {
                    return 0;
                }
                samplerManualBuffer = Arrays.copyOf(data, data.length);
                connection.loadBuffer(data);
                return data.length;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptBufferSaveBytesFile", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                String path = String.valueOf(args[0] != null ? args[0] : "").trim();
                if (path.isEmpty()) {
                    return Context.getUndefinedValue();
                }
                try {
                    File file = new File(path);
                    File parent = file.getParentFile();
                    if (parent != null && !parent.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        parent.mkdirs();
                    }
                    byte[] data = readSamplerBytesSnapshot();
                    try (FileOutputStream fos = new FileOutputStream(file, false)) {
                        fos.write(data);
                        fos.flush();
                    }
                } catch (Exception ex) {
                    dispatchError("Script error: save buffer failed: " + ex.getMessage());
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptBufferBuildSignedRawTimings", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                int samplePeriodUs = 1;
                if (args.length >= 1 && args[0] instanceof Number) {
                    samplePeriodUs = Math.max(1, ((Number) args[0]).intValue());
                }
                return buildSignedRawTimings(readSamplerBytesSnapshot(), samplePeriodUs);
            }
        });

        ScriptableObject.putProperty(scope, "_scriptDeviceTransmitBufferStart", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return 0;
                }
                byte[] data = coerceToByteArray(args[0]);
                if (data == null) {
                    return 0;
                }

                ScriptDeviceBridge connection = deviceConnection;
                if (connection == null || !connection.isConnected()) {
                    return 0;
                }

                int pin = 1;
                int dutyPercent = 100;
                int tickUs = 10;
                long freqHz = 0;

                if (args.length >= 2) {
                    Map<String, Object> opts = coerceToMap(args[1]);
                    if (opts != null) {
                        pin = clamp(ScriptValueUtils.asInteger(opts.get("pin"), pin), 0, 255);
                        dutyPercent = clamp(ScriptValueUtils.asInteger(opts.get("dutyPercent"), dutyPercent), 1, 100);
                        tickUs = clamp(ScriptValueUtils.asInteger(opts.get("tickUs"), tickUs), 5, 255);
                        Integer hzInt = ScriptValueUtils.asInteger(opts.get("freqHz"), null);
                        if (hzInt != null) {
                            freqHz = hzInt & 0xFFFFFFFFL;
                        }
                    }
                }

                byte[] pkt = new byte[9];
                pkt[0] = (byte) 0x80;
                pkt[1] = (byte) 0x00;
                pkt[2] = (byte) (pin & 0xFF);
                pkt[3] = (byte) (dutyPercent & 0xFF);
                pkt[4] = (byte) (freqHz & 0xFF);
                pkt[5] = (byte) ((freqHz >> 8) & 0xFF);
                pkt[6] = (byte) ((freqHz >> 16) & 0xFF);
                pkt[7] = (byte) ((freqHz >> 24) & 0xFF);
                pkt[8] = (byte) (tickUs & 0xFF);

                try {
                    byte[] resp = connection.sendPacket(pkt, 1500);
                    if (!isOkResponse(resp)) {
                        dispatchError("Script error: transmit start failed");
                        return 0;
                    }
                    samplerManualBuffer = Arrays.copyOf(data, data.length);
                    connection.loadBuffer(data);
                    connection.transmitBuffer();

                    String doneToken = null;
                    if (args.length >= 3 && args[2] != null && args[2] != Undefined.instance) {
                        doneToken = String.valueOf(args[2]);
                    }
                    if (doneToken != null && !doneToken.isEmpty()) {
                        invokeRegisteredCallback(cx, doneToken);
                    }
                } catch (Exception ex) {
                    dispatchError("Script error: transmit failed: " + ex.getMessage());
                    return 0;
                }
                return data.length;
            }
        });

        ScriptableObject.putProperty(scope, "_scriptAppDataDir", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                File root = getAppDataDir();
                return root.getAbsolutePath();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptPathJoin", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return "";
                }
                List<String> parts = coerceToStringList(args[0]);
                if (parts.isEmpty()) {
                    return "";
                }
                File joined = null;
                for (String part : parts) {
                    String p = part != null ? part : "";
                    if (joined == null) {
                        joined = new File(p);
                    } else {
                        joined = new File(joined, p);
                    }
                }
                return joined != null ? joined.getPath() : "";
            }
        });

        ScriptableObject.putProperty(scope, "_scriptEnsureDir", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                File dir = resolveWithinAppData(String.valueOf(args[0]), true);
                if (!dir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptReadDir", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                String raw = args.length >= 1 ? String.valueOf(args[0]) : "";
                File dir = resolveWithinAppData(raw, true);
                List<String> names = new ArrayList<>();

                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (f != null) {
                            names.add(f.getName());
                        }
                    }
                }

                if (isPrimarySignalsDir(dir)) {
                    List<File> legacyDirs = legacySignalDirs;
                    for (File legacy : legacyDirs) {
                        try {
                            if (legacy == null || !legacy.exists() || !legacy.isDirectory()) {
                                continue;
                            }
                            File[] legacyFiles = legacy.listFiles();
                            if (legacyFiles == null) {
                                continue;
                            }
                            for (File f : legacyFiles) {
                                if (f != null) {
                                    names.add(f.getName());
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
                }

                if (names.isEmpty()) {
                    return cx.newArray(scope, new Object[0]);
                }
                java.util.LinkedHashSet<String> unique = new java.util.LinkedHashSet<>(names);
                names = new ArrayList<>(unique);
                Collections.sort(names, String::compareToIgnoreCase);
                return cx.newArray(scope, names.toArray(new Object[0]));
            }
        });

        ScriptableObject.putProperty(scope, "_scriptReadFileText", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return "";
                }
                String rawPath = String.valueOf(args[0]);
                File file = resolveExistingReadableFile(rawPath);
                byte[] bytes = readAllBytes(file);
                return new String(bytes, StandardCharsets.UTF_8);
            }
        });

        ScriptableObject.putProperty(scope, "_scriptWriteFileText", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                String content = args.length >= 2 ? String.valueOf(args[1]) : "";
                File file = resolveWithinAppData(String.valueOf(args[0]), false);
                writeAllBytes(file, content.getBytes(StandardCharsets.UTF_8));
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptReadFileBytes", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return cx.newArray(scope, new Object[0]);
                }
                String rawPath = String.valueOf(args[0]);
                File file = resolveExistingReadableFile(rawPath);
                return toJsByteArray(cx, scope, readAllBytes(file));
            }
        });

        ScriptableObject.putProperty(scope, "_scriptWriteFileBytes", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                byte[] data = args.length >= 2 ? coerceToByteArray(args[1]) : new byte[0];
                if (data == null) {
                    data = new byte[0];
                }
                File file = resolveWithinAppData(String.valueOf(args[0]), false);
                writeAllBytes(file, data);
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptRemovePath", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    return Context.getUndefinedValue();
                }
                File file = resolveWithinAppData(String.valueOf(args[0]), false);
                deleteRecursively(file);
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptRenamePath", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2) {
                    return Context.getUndefinedValue();
                }
                File from = resolveWithinAppData(String.valueOf(args[0]), false);
                File to = resolveWithinAppData(String.valueOf(args[1]), false);
                File parent = to.getParentFile();
                if (parent != null && !parent.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }
                if (!from.renameTo(to)) {
                    throw new EvaluatorException("rename failed");
                }
                return Context.getUndefinedValue();
            }
        });

        ScriptableObject.putProperty(scope, "_scriptRevealInFinder", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Context.getUndefinedValue();
            }
        });

        ScriptPlotBufferStore.setProvider("samplerBits", this::readSamplerBytesSnapshot);

        // Minimal timer API: setTimeout/clearTimeout.
        // Important: scheduled callback execution is always marshaled back onto the ScriptEngine executor
        // so JSContext access stays single-threaded.
        ScriptableObject.putProperty(scope, "setTimeout", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 2 || !(args[0] instanceof Function)) {
                    throw new EvaluatorException("setTimeout(fn, ms): fn must be a function");
                }
                Function fn = (Function) args[0];
                long delayMs = 0;
                if (args[1] instanceof Number) {
                    delayMs = Math.max(0L, ((Number) args[1]).longValue());
                }

                Object[] fnArgs = Context.emptyArgs;
                if (args.length > 2) {
                    fnArgs = new Object[args.length - 2];
                    System.arraycopy(args, 2, fnArgs, 0, fnArgs.length);
                }
                final Object[] capturedArgs = fnArgs;

                int id = nextTimeoutId.getAndIncrement();
                ScheduledFuture<?> future = timerExecutor.schedule(() -> executor.execute(() -> {
                    ScheduledFuture<?> existing = timeoutFutures.remove(id);
                    if (existing == null || existing.isCancelled()) {
                        return;
                    }
                    Context innerCx = Context.enter();
                    try {
                        innerCx.setOptimizationLevel(-1);
                        innerCx.setLanguageVersion(Context.VERSION_ES6);
                        ensureScope(innerCx);
                        fn.call(innerCx, ScriptEngine.this.scope, ScriptEngine.this.scope, capturedArgs);
                    } catch (RhinoException ex) {
                        dispatchError("Script timer error: " + formatRhinoException(ex));
                    } catch (Exception ex) {
                        dispatchError("Script timer error: " + ex.getMessage());
                    } finally {
                        Context.exit();
                    }
                }), delayMs, TimeUnit.MILLISECONDS);

                timeoutFutures.put(id, future);
                return id;
            }
        });

        ScriptableObject.putProperty(scope, "clearTimeout", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length == 0) {
                    return Context.getUndefinedValue();
                }
                int id;
                Object raw = args[0];
                if (raw instanceof Number) {
                    id = ((Number) raw).intValue();
                } else {
                    try {
                        id = Integer.parseInt(String.valueOf(raw));
                    } catch (NumberFormatException e) {
                        return Context.getUndefinedValue();
                    }
                }
                ScheduledFuture<?> future = timeoutFutures.remove(id);
                if (future != null) {
                    future.cancel(false);
                }
                return Context.getUndefinedValue();
            }
        });
    }

    private Scriptable parseJsonNode(Context cx, Scriptable scope, String json) {
        if (json == null || json.isEmpty()) {
            return null;
        }
        Object jsonObj = ScriptableObject.getProperty(scope, "JSON");
        if (!(jsonObj instanceof Scriptable)) {
            return null;
        }
        Scriptable jsonScriptable = (Scriptable) jsonObj;
        Object parseObj = ScriptableObject.getProperty(jsonScriptable, "parse");
        if (!(parseObj instanceof Function)) {
            return null;
        }
        Object parsed = ((Function) parseObj).call(cx, scope, jsonScriptable, new Object[]{json});
        if (parsed instanceof Scriptable) {
            return (Scriptable) parsed;
        }
        return null;
    }

    private boolean containsAsyncTokens(String script) {
        if (script == null || script.isEmpty()) {
            return false;
        }
        // Intentionally simple: reject if any async/await tokens are present.
        // This may false-positive on strings/comments, but keeps behavior aligned across platforms.
        return script.contains("await") || script.contains("async");
    }

    private void clearAllTimeouts() {
        for (Map.Entry<Integer, ScheduledFuture<?>> entry : timeoutFutures.entrySet()) {
            ScheduledFuture<?> future = entry.getValue();
            if (future != null) {
                future.cancel(false);
            }
        }
        timeoutFutures.clear();
    }

    private Object toJsByteArray(Context cx, Scriptable scope, byte[] bytes) {
        if (bytes == null) {
            return null;
        }
        Object[] items = new Object[bytes.length];
        for (int i = 0; i < bytes.length; i++) {
            items[i] = (double) (bytes[i] & 0xFF);
        }
        return cx.newArray(scope, items);
    }

    private byte[] coerceToByteArray(Object value) {
        if (value == null || value == Undefined.instance) {
            return null;
        }
        if (value instanceof Wrapper) {
            value = ((Wrapper) value).unwrap();
        }
        if (value instanceof byte[]) {
            return (byte[]) value;
        }
        if (value instanceof NativeArray) {
            NativeArray array = (NativeArray) value;
            int length = (int) array.getLength();
            byte[] out = new byte[length];
            for (int i = 0; i < length; i++) {
                Object v = array.get(i, array);
                int b = v instanceof Number ? ((Number) v).intValue() : 0;
                out[i] = (byte) (b & 0xFF);
            }
            return out;
        }
        if (value instanceof Scriptable) {
            Scriptable s = (Scriptable) value;
            Object lenObj = ScriptableObject.getProperty(s, "length");
            int length = 0;
            if (lenObj instanceof Number) {
                length = Math.max(0, ((Number) lenObj).intValue());
            }
            byte[] out = new byte[length];
            for (int i = 0; i < length; i++) {
                Object v = ScriptableObject.getProperty(s, i);
                int b = v instanceof Number ? ((Number) v).intValue() : 0;
                out[i] = (byte) (b & 0xFF);
            }
            return out;
        }

        try {
            Object converted = Context.jsToJava(value, byte[].class);
            if (converted instanceof byte[]) {
                return (byte[]) converted;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private Map<String, Object> coerceToMap(Object value) {
        if (value == null || value == Undefined.instance) {
            return null;
        }
        if (value instanceof Wrapper) {
            value = ((Wrapper) value).unwrap();
        }
        if (value instanceof Map<?, ?>) {
            Map<String, Object> out = new HashMap<>();
            Map<?, ?> map = (Map<?, ?>) value;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) {
                    out.put(String.valueOf(entry.getKey()), entry.getValue());
                }
            }
            return out;
        }
        if (value instanceof Scriptable) {
            return toJavaMap((Scriptable) value);
        }
        return null;
    }

    private byte[] readSamplerBytesSnapshot() {
        byte[] manual = samplerManualBuffer;
        if (manual != null) {
            return Arrays.copyOf(manual, manual.length);
        }
        ScriptDeviceBridge connection = deviceConnection;
        if (connection == null) {
            return new byte[0];
        }
        byte[] data = connection.getBuffer();
        return data != null ? data : new byte[0];
    }

    private int getSamplerPacketSizeBytes() {
        ScriptDeviceBridge connection = deviceConnection;
        if (connection == null) {
            return ScriptDeviceBridge.DEFAULT_PACKET_SIZE_BYTES;
        }
        return Math.max(1, connection.getBufferPacketSizeBytes());
    }

    private void invokeRegisteredCallback(Context cx, String token) {
        if (token == null || token.isEmpty()) {
            return;
        }
        Function fn = callbackRegistry.get(token);
        if (fn == null || scope == null) {
            return;
        }
        fn.call(cx, scope, scope, Context.emptyArgs);
    }

    private boolean isOkResponse(byte[] resp) {
        return resp != null && resp.length > 0 && (resp[0] & 0xFF) == 0x80;
    }

    private int clamp(Integer value, int lo, int hi) {
        int n = value != null ? value : lo;
        if (n < lo) return lo;
        return Math.min(n, hi);
    }

    private String buildSignedRawTimings(byte[] data, int samplePeriodUs) {
        if (data == null || data.length == 0) {
            return "";
        }
        int period = Math.max(1, samplePeriodUs);
        int totalBits = data.length * 8;
        StringBuilder out = new StringBuilder(Math.max(64, totalBits / 8));

        boolean currentState = ((data[0] & 0x01) == 1);
        int count = 0;

        for (int i = 0; i < totalBits; i++) {
            int byteIndex = i >> 3;
            int bitIndex = i & 7;
            boolean bit = (((data[byteIndex] >> bitIndex) & 0x01) == 1);
            if (bit == currentState) {
                count++;
            } else {
                appendTiming(out, currentState, count * period);
                currentState = bit;
                count = 1;
            }
        }
        appendTiming(out, currentState, count * period);
        return out.toString();
    }

    private void appendTiming(StringBuilder out, boolean stateHigh, int microseconds) {
        if (microseconds <= 0) {
            return;
        }
        if (out.length() > 0) {
            out.append(' ');
        }
        if (!stateHigh) {
            out.append('-');
        }
        out.append(microseconds);
    }

    private File getAppDataDir() {
        File configured = appDataDir;
        if (configured != null) {
            if (!configured.exists()) {
                //noinspection ResultOfMethodCallIgnored
                configured.mkdirs();
            }
            return configured;
        }
        File fallback = new File(System.getProperty("java.io.tmpdir"), "emwaver-script-data");
        if (!fallback.exists()) {
            //noinspection ResultOfMethodCallIgnored
            fallback.mkdirs();
        }
        return fallback;
    }

    private File resolveWithinAppData(String rawPath, boolean treatAsDirectory) {
        File root = getAppDataDir();
        String raw = rawPath != null ? rawPath.trim() : "";
        File candidate = raw.isEmpty() ? root : new File(raw);
        if (!candidate.isAbsolute()) {
            candidate = new File(root, raw);
        }

        try {
            File rootCanonical = root.getCanonicalFile();
            File candidateCanonical = candidate.getCanonicalFile();
            if (!isWithinRoot(rootCanonical, candidateCanonical)) {
                throw new EvaluatorException("Path escapes app data directory");
            }
            if (treatAsDirectory && !candidateCanonical.exists()) {
                //noinspection ResultOfMethodCallIgnored
                candidateCanonical.mkdirs();
            }
            return candidateCanonical;
        } catch (IOException e) {
            throw new EvaluatorException("Path resolution failed: " + e.getMessage());
        }
    }

    private boolean isPrimarySignalsDir(File dir) {
        if (dir == null) {
            return false;
        }
        try {
            File primary = getAppDataDir().getCanonicalFile();
            return dir.getCanonicalFile().equals(primary);
        } catch (IOException e) {
            return false;
        }
    }

    private File resolveExistingReadableFile(String rawPath) {
        File primary = resolveWithinAppData(rawPath, false);
        if (primary.exists() && primary.isFile()) {
            return primary;
        }

        File appRoot = getAppDataDir();
        if (primary.getParentFile() != null && primary.getParentFile().equals(appRoot)) {
            String baseName = primary.getName();
            if (!baseName.isEmpty()) {
                for (File legacyDir : legacySignalDirs) {
                    try {
                        if (legacyDir == null || !legacyDir.exists() || !legacyDir.isDirectory()) {
                            continue;
                        }
                        File candidate = new File(legacyDir, baseName);
                        if (candidate.exists() && candidate.isFile()) {
                            return candidate;
                        }
                    } catch (Exception ignored) {
                    }
                }
            }
        }
        return primary;
    }

    private boolean isWithinRoot(File root, File child) {
        String rootPath = root.getPath();
        String childPath = child.getPath();
        if (childPath.equals(rootPath)) {
            return true;
        }
        return childPath.startsWith(rootPath + File.separator);
    }

    private byte[] readAllBytes(File file) {
        if (file == null || !file.exists() || !file.isFile()) {
            return new byte[0];
        }
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[4096];
            int read;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            while ((read = fis.read(buffer)) != -1) {
                if (read > 0) {
                    bos.write(buffer, 0, read);
                }
            }
            return bos.toByteArray();
        } catch (IOException e) {
            throw new EvaluatorException("Read failed: " + e.getMessage());
        }
    }

    private void writeAllBytes(File file, byte[] data) {
        if (file == null) {
            return;
        }
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();
        }
        try (FileOutputStream fos = new FileOutputStream(file, false)) {
            fos.write(data != null ? data : new byte[0]);
            fos.flush();
        } catch (IOException e) {
            throw new EvaluatorException("Write failed: " + e.getMessage());
        }
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private List<String> coerceToStringList(Object value) {
        List<String> out = new ArrayList<>();
        if (value == null || value == Undefined.instance) {
            return out;
        }
        if (value instanceof NativeArray) {
            NativeArray array = (NativeArray) value;
            int length = (int) array.getLength();
            for (int i = 0; i < length; i++) {
                Object v = array.get(i, array);
                out.add(v != null && v != Undefined.instance ? String.valueOf(v) : "");
            }
            return out;
        }
        if (value instanceof List<?>) {
            for (Object v : (List<?>) value) {
                out.add(v != null ? String.valueOf(v) : "");
            }
            return out;
        }
        out.add(String.valueOf(value));
        return out;
    }

    private void injectDsl(Context cx, Scriptable scope) {
        String source = bootstrapSource;
        if (source == null || source.trim().isEmpty()) {
            throw new EvaluatorException("Script kernel not loaded (missing emw-kernel.emw)");
        }
        cx.evaluateString(scope, source, "ScriptBootstrap", 1, null);
    }

    private void installRequire(Context cx, Scriptable scope) {
        Scriptable moduleCache = cx.newObject(scope);
        ScriptableObject.putProperty(scope, "__emwModuleCache", moduleCache);
        ScriptableObject.putProperty(scope, "require", new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 1) {
                    throw new EvaluatorException("require() needs a module name");
                }
                String moduleName = String.valueOf(args[0]);
                String resolved = resolveModuleName(moduleName);
                if (resolved == null) {
                    throw new EvaluatorException("Cannot find EMWaver module: " + moduleName);
                }
                Object cached = ScriptableObject.getProperty(moduleCache, resolved);
                if (cached != Scriptable.NOT_FOUND) {
                    return cached;
                }

                String source = moduleSources.get(resolved);
                if (source == null) {
                    source = moduleSources.get(resolved + ".emw");
                }
                if (source == null) {
                    source = moduleSources.get(resolved + ".js");
                }
                if (source == null) {
                    throw new EvaluatorException("Cannot find EMWaver module source: " + moduleName);
                }

                Scriptable exports = cx.newObject(scope);
                Scriptable module = cx.newObject(scope);
                ScriptableObject.putProperty(module, "exports", exports);
                ScriptableObject.putProperty(moduleCache, resolved, exports);

                String transformed = ScriptSourceTranspiler.transpile(source);
                String wrapped = "(function(exports, module, require) {\n" + transformed + "\n})";
                Object fnObj = cx.evaluateString(scope, wrapped, "Module:" + resolved, 1, null);
                if (!(fnObj instanceof Function)) {
                    throw new EvaluatorException("Invalid EMWaver module: " + moduleName);
                }
                ((Function) fnObj).call(cx, scope, scope, new Object[] { exports, module, this });
                Object moduleExports = ScriptableObject.getProperty(module, "exports");
                ScriptableObject.putProperty(moduleCache, resolved, moduleExports);
                return moduleExports;
            }
        });
    }

    private String resolveModuleName(String moduleName) {
        String trimmed = moduleName != null ? moduleName.trim() : "";
        if (trimmed.isEmpty()) {
            return null;
        }
        if (moduleSources.containsKey(trimmed)) {
            return trimmed;
        }
        if (trimmed.endsWith(".emw")) {
            String without = trimmed.substring(0, trimmed.length() - 4);
            if (moduleSources.containsKey(without)) {
                return without;
            }
        } else if (trimmed.endsWith(".js")) {
            String without = trimmed.substring(0, trimmed.length() - 3);
            if (moduleSources.containsKey(without)) {
                return without;
            }
        } else if (moduleSources.containsKey(trimmed + ".emw")) {
            return trimmed + ".emw";
        } else if (moduleSources.containsKey(trimmed + ".js")) {
            return trimmed + ".js";
        }
        return null;
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
            return sanitizeLayoutProps(toJavaMap((Scriptable) propsObj));
        }
        return new HashMap<>();
    }

    private Map<String, Object> sanitizeLayoutProps(Map<String, Object> props) {
        if (props == null || props.isEmpty()) {
            return props;
        }
        Map<String, Object> cleaned = new HashMap<>(props);
        cleaned.remove("x");
        cleaned.remove("y");
        cleaned.remove("left");
        cleaned.remove("top");
        cleaned.remove("right");
        cleaned.remove("bottom");
        Object position = cleaned.get("position");
        if (position != null && "absolute".equalsIgnoreCase(String.valueOf(position))) {
            cleaned.remove("position");
        }
        return cleaned;
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

    private void dispatchError(String message) {
        if (errorCallback == null) {
            return;
        }
        mainHandler.post(() -> errorCallback.onError(message));
    }

    private void dispatchRender(ScriptTree tree) {
        if (renderCallback == null) {
            return;
        }
        mainHandler.post(() -> renderCallback.onRender(tree));
    }

}
