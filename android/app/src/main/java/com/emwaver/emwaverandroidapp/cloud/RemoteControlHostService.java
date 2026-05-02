/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Android Host Session Remote Control (v1).
 *
 * - Connects as role=host to backend /v1/ws
 * - Receives script.run + ui.event
 * - Sends ui.snapshot
 *
 * This is best-effort and intentionally simple (snapshot-only UI).
 */
public final class RemoteControlHostService {

    public interface Delegate {
        void onRemoteControlActiveChanged(boolean active);

        // Run a script on the host. Delegate should render it and call publishUiSnapshot when UI changes.
        void runRemoteScript(@NonNull String source, @Nullable String name, @NonNull String scriptInstanceId);

        // Dispatch a UI event (tap/change/select/submit/etc.).
        void dispatchRemoteUiEvent(@NonNull String scriptInstanceId, @NonNull String targetNodeId, @NonNull String eventName, @NonNull JSONObject payload);

        // Provide the current ScriptTree root for snapshot encoding (or null if none).
        @Nullable Object getActiveScriptTree();
    }

    private static volatile RemoteControlHostService instance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder().build();

    private WebSocket socket;
    private boolean remoteControlled;

    private String activeScriptInstanceId;
    private int uiRev;

    private WeakReference<Delegate> delegateRef;

    private RemoteControlHostService() {}

    public static RemoteControlHostService getInstance() {
        if (instance == null) {
            synchronized (RemoteControlHostService.class) {
                if (instance == null) instance = new RemoteControlHostService();
            }
        }
        return instance;
    }

    public void setDelegate(@Nullable Delegate delegate) {
        this.delegateRef = delegate != null ? new WeakReference<>(delegate) : null;
        if (delegate != null) {
            delegate.onRemoteControlActiveChanged(remoteControlled);
        }
    }

    public boolean isRemoteControlled() {
        return remoteControlled;
    }

    public void start(@NonNull Context context) {
        if (!CloudConfig.isHostedRemoteControlEnabled()) {
            stop();
            return;
        }

        Context app = context.getApplicationContext();
        // Run connection attempts off main.
        new Thread(() -> connectLoop(app)).start();
    }

    public void stop() {
        if (socket != null) {
            try {
                socket.close(1001, "going_away");
            } catch (Exception ignored) {}
            socket = null;
        }
        setRemoteControlled(false);
    }

    private void connectLoop(@NonNull Context context) {
        while (true) {
            try {
                if (socket == null) {
                    connectOnce(context);
                }
                Thread.sleep(2000);
            } catch (Exception ignored) {
                try { Thread.sleep(2000); } catch (InterruptedException e) { return; }
            }
        }
    }

    private void connectOnce(@NonNull Context context) {
        try {
            CloudAuthManager auth = CloudAuthManager.getInstance();
            auth.ensureInitialized(context);
            String tok = auth.getIdTokenBlocking();
            if (tok == null || tok.trim().isEmpty()) {
                return;
            }

            String baseUrl = CloudConfig.getBackendBaseUrl(context);
            if (baseUrl == null || baseUrl.trim().isEmpty()) {
                return;
            }

            String wsUrl = baseUrl.trim();
            if (wsUrl.endsWith("/")) wsUrl = wsUrl.substring(0, wsUrl.length() - 1);
            wsUrl = wsUrl.replace("https://", "wss://").replace("http://", "ws://");
            wsUrl = wsUrl + "/v1/ws?token=" + java.net.URLEncoder.encode(tok.trim(), "UTF-8");

            String hostSessionId = getOrCreateHostId(context);

            Request req = new Request.Builder().url(wsUrl).build();
            socket = http.newWebSocket(req, new WebSocketListener() {
                @Override
                public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                    try {
                        JSONObject hello = new JSONObject();
                        hello.put("type", "hello");
                        hello.put("role", "host");
                        hello.put("protocolVersion", 1);
                        hello.put("hostSessionId", hostSessionId);
                        webSocket.send(hello.toString());
                    } catch (Exception ignored) {
                    }
                }

                @Override
                public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                    handleIncoming(context, text);
                }

                @Override
                public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                    socket = null;
                    setRemoteControlled(false);
                }

                @Override
                public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                    socket = null;
                    setRemoteControlled(false);
                }
            });

        } catch (Exception ignored) {
            socket = null;
            setRemoteControlled(false);
        }
    }

    private void setRemoteControlled(boolean on) {
        if (remoteControlled == on) return;
        remoteControlled = on;
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) {
            mainHandler.post(() -> d.onRemoteControlActiveChanged(on));
        }
    }

    private void handleIncoming(@NonNull Context context, @NonNull String text) {
        try {
            JSONObject msg = new JSONObject(text);
            String type = msg.optString("type", "");

            if ("host.attach".equals(type)) {
                setRemoteControlled(true);
                return;
            }

            if ("script.run".equals(type)) {
                String source = msg.optString("source", "");
                String name = msg.optString("name", "");
                if (source == null || source.trim().isEmpty()) {
                    sendScriptError("missing_source");
                    return;
                }

                activeScriptInstanceId = UUID.randomUUID().toString();
                uiRev = 0;

                Delegate d = delegateRef != null ? delegateRef.get() : null;
                if (d != null) {
                    String finalName = name != null && !name.trim().isEmpty() ? name.trim() : null;
                    mainHandler.post(() -> d.runRemoteScript(source, finalName, activeScriptInstanceId));
                }

                JSONObject started = new JSONObject();
                started.put("type", "script.started");
                started.put("scriptInstanceId", activeScriptInstanceId);
                socketSend(started);
                return;
            }

            if ("ui.event".equals(type)) {
                String scriptId = msg.optString("scriptInstanceId", "");
                if (scriptId == null || !scriptId.equals(activeScriptInstanceId)) return;

                String targetNodeId = msg.optString("targetNodeId", "");
                String name = msg.optString("name", "");
                JSONObject payload = msg.optJSONObject("payload");
                if (payload == null) payload = new JSONObject();

                Delegate d = delegateRef != null ? delegateRef.get() : null;
                if (d != null) {
                    JSONObject finalPayload = payload;
                    mainHandler.post(() -> d.dispatchRemoteUiEvent(scriptId, targetNodeId, name, finalPayload));
                }
                return;
            }

        } catch (Exception ignored) {
        }
    }

    public void publishUiSnapshot(@NonNull String hostSessionId, @NonNull Object rootNode) {
        // Delegate should call this when its ScriptTree changes.
        if (socket == null) return;
        if (activeScriptInstanceId == null || activeScriptInstanceId.trim().isEmpty()) return;

        try {
            uiRev += 1;

            JSONObject snap = new JSONObject();
            snap.put("type", "ui.snapshot");
            snap.put("hostSessionId", hostSessionId);
            snap.put("scriptInstanceId", activeScriptInstanceId);
            snap.put("rev", uiRev);

            // rootNode expected to be com.emwaver...scripts.ScriptNode
            snap.put("root", encodeNode(rootNode));

            socketSend(snap);
        } catch (Exception ignored) {
        }
    }

    private void sendScriptError(@NonNull String err) {
        try {
            JSONObject e = new JSONObject();
            e.put("type", "script.error");
            e.put("error", err);
            socketSend(e);
        } catch (Exception ignored) {
        }
    }

    private void socketSend(@NonNull JSONObject obj) {
        try {
            if (socket != null) {
                socket.send(obj.toString());
            }
        } catch (Exception ignored) {
        }
    }

    private static String getOrCreateHostId(@NonNull Context context) {
        SharedPreferences prefs = context.getSharedPreferences("emwaver", Context.MODE_PRIVATE);
        String key = "emwaver.hostSessionId";
        String v = prefs.getString(key, "");
        if (v != null && !v.trim().isEmpty()) return v.trim();
        String id = UUID.randomUUID().toString();
        prefs.edit().putString(key, id).apply();
        return id;
    }

    // --- JSON encoding of ScriptNode (best-effort) ---

    private JSONObject encodeNode(@NonNull Object scriptNodeObj) {
        try {
            // ScriptNode API
            com.emwaver.emwaverandroidapp.scripts.ScriptNode n = (com.emwaver.emwaverandroidapp.scripts.ScriptNode) scriptNodeObj;

            JSONObject o = new JSONObject();
            o.put("id", n.getId());
            o.put("type", n.getType() != null ? n.getType().getRawValue() : "unknown");

            // props
            JSONObject props = new JSONObject();
            Map<String, Object> raw = n.getProps() != null ? n.getProps().getRaw() : null;
            if (raw != null) {
                for (Map.Entry<String, Object> e : raw.entrySet()) {
                    props.put(e.getKey(), toJsonValue(e.getValue()));
                }
            }
            o.put("props", props);

            // handlers
            if (n.getProps() != null && n.getProps().getEventHandlers() != null && !n.getProps().getEventHandlers().isEmpty()) {
                JSONObject handlers = new JSONObject();
                for (Map.Entry<com.emwaver.emwaverandroidapp.scripts.ScriptEventType, String> e : n.getProps().getEventHandlers().entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) {
                        handlers.put(e.getKey().getRawValue(), e.getValue());
                    }
                }
                o.put("handlers", handlers);
            }

            // children
            JSONArray kids = new JSONArray();
            List<com.emwaver.emwaverandroidapp.scripts.ScriptNode> children = n.getChildren();
            if (children != null) {
                for (com.emwaver.emwaverandroidapp.scripts.ScriptNode c : children) {
                    kids.put(encodeNode(c));
                }
            }
            o.put("children", kids);

            return o;
        } catch (Exception ex) {
            return new JSONObject();
        }
    }

    private Object toJsonValue(@Nullable Object v) {
        if (v == null) return JSONObject.NULL;
        if (v instanceof JSONObject) return v;
        if (v instanceof JSONArray) return v;
        if (v instanceof String) return v;
        if (v instanceof Boolean) return v;
        if (v instanceof Integer || v instanceof Long || v instanceof Double || v instanceof Float) return v;
        if (v instanceof Number) return ((Number) v).doubleValue();

        if (v instanceof Map) {
            JSONObject o = new JSONObject();
            Map<?, ?> m = (Map<?, ?>) v;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                try {
                    String k = String.valueOf(e.getKey());
                    o.put(k, toJsonValue(e.getValue()));
                } catch (Exception ignored) {}
            }
            return o;
        }

        if (v instanceof List) {
            JSONArray a = new JSONArray();
            List<?> list = (List<?>) v;
            for (Object it : list) {
                a.put(toJsonValue(it));
            }
            return a;
        }

        // Fallback to string.
        return String.valueOf(v);
    }
}
