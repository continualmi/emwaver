/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.scripts.ScriptEventType;
import com.emwaver.emwaverandroidapp.scripts.ScriptNode;
import com.emwaver.emwaverandroidapp.scripts.ScriptNodeProps;
import com.emwaver.emwaverandroidapp.scripts.ScriptNodeType;
import com.emwaver.emwaverandroidapp.scripts.ScriptTree;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Android Remote Control CLIENT (controller) (v1).
 *
 * Same wire protocol as the web frontend:
 * - Connect to /v1/ws
 * - hello role=web
 * - host.attach {hostSessionId}
 * - script.run {hostSessionId,name,source}
 * - ui.event {hostSessionId,scriptInstanceId,baseRev,targetNodeId,name,payload}
 *
 * Receives:
 * - host.attached
 * - script.started
 * - ui.snapshot
 */
public final class RemoteControlClientService {

    public interface Delegate {
        void onStatus(@NonNull String status);

        void onAttached(@NonNull String hostSessionId);

        void onScriptStarted(@NonNull String hostSessionId, @NonNull String scriptInstanceId, @Nullable String name);

        void onUiSnapshot(@NonNull String hostSessionId, @NonNull String scriptInstanceId, int rev, @Nullable ScriptTree tree);

        void onError(@NonNull String message);
    }

    private static volatile RemoteControlClientService instance;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder().build();

    private WebSocket socket;
    private String attachedHostSessionId;

    private WeakReference<Delegate> delegateRef;

    private RemoteControlClientService() {}

    public static RemoteControlClientService getInstance() {
        if (instance == null) {
            synchronized (RemoteControlClientService.class) {
                if (instance == null) instance = new RemoteControlClientService();
            }
        }
        return instance;
    }

    public void setDelegate(@Nullable Delegate delegate) {
        this.delegateRef = delegate != null ? new WeakReference<>(delegate) : null;
    }

    public void connectAndAttach(@NonNull Context context, @NonNull String hostSessionId) {
        Context app = context.getApplicationContext();
        // Keep it simple: one socket, re-connect on demand.
        stop();
        new Thread(() -> connectOnce(app, hostSessionId)).start();
    }

    public void stop() {
        attachedHostSessionId = null;
        if (socket != null) {
            try {
                socket.close(1001, "going_away");
            } catch (Exception ignored) {}
            socket = null;
        }
        postStatus("disconnected");
    }

    public boolean isAttached() {
        return socket != null && attachedHostSessionId != null && !attachedHostSessionId.trim().isEmpty();
    }

    public void runScript(@NonNull String name, @NonNull String source) {
        if (socket == null || attachedHostSessionId == null) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("type", "script.run");
            obj.put("hostSessionId", attachedHostSessionId);
            obj.put("name", name);
            obj.put("source", source);
            socket.send(obj.toString());
        } catch (Exception ignored) {}
    }

    public void sendUiEvent(@NonNull String scriptInstanceId, int baseRev, @NonNull String targetNodeId, @NonNull ScriptEventType eventType, @Nullable Object value) {
        if (socket == null || attachedHostSessionId == null) return;
        try {
            JSONObject payload = new JSONObject();
            if (value != null && (eventType == ScriptEventType.CHANGE || eventType == ScriptEventType.SUBMIT)) {
                payload.put("value", wrapJson(value));
            }

            JSONObject obj = new JSONObject();
            obj.put("type", "ui.event");
            obj.put("hostSessionId", attachedHostSessionId);
            obj.put("scriptInstanceId", scriptInstanceId);
            obj.put("baseRev", baseRev);
            obj.put("targetNodeId", targetNodeId);
            obj.put("name", eventType.getRawValue());
            obj.put("payload", payload);
            socket.send(obj.toString());
        } catch (Exception ignored) {}
    }

    private void connectOnce(@NonNull Context context, @NonNull String hostSessionId) {
        try {
            postStatus("connecting");

            CloudAuthManager auth = CloudAuthManager.getInstance();
            auth.ensureInitialized(context);
            String tok = auth.getIdTokenBlocking();
            if (tok == null) tok = "";

            String baseUrl = CloudConfig.getBackendBaseUrl(context);
            if (baseUrl == null || baseUrl.trim().isEmpty()) {
                postError("missing backend url");
                return;
            }

            String wsUrl = baseUrl.trim();
            if (wsUrl.endsWith("/")) wsUrl = wsUrl.substring(0, wsUrl.length() - 1);
            wsUrl = wsUrl.replace("https://", "wss://").replace("http://", "ws://");
            wsUrl = wsUrl + "/v1/ws";
            if (tok != null && !tok.trim().isEmpty()) {
                wsUrl = wsUrl + "?token=" + URLEncoder.encode(tok.trim(), "UTF-8");
            }

            Request req = new Request.Builder().url(wsUrl).build();
            socket = http.newWebSocket(req, new WebSocketListener() {
                @Override
                public void onOpen(@NonNull WebSocket webSocket, @NonNull Response response) {
                    postStatus("open");
                    try {
                        JSONObject hello = new JSONObject();
                        hello.put("type", "hello");
                        hello.put("role", "web");
                        hello.put("protocolVersion", 1);
                        webSocket.send(hello.toString());

                        JSONObject attach = new JSONObject();
                        attach.put("type", "host.attach");
                        attach.put("hostSessionId", hostSessionId);
                        webSocket.send(attach.toString());
                    } catch (Exception ignored) {}
                }

                @Override
                public void onMessage(@NonNull WebSocket webSocket, @NonNull String text) {
                    handleIncoming(text);
                }

                @Override
                public void onClosed(@NonNull WebSocket webSocket, int code, @NonNull String reason) {
                    socket = null;
                    attachedHostSessionId = null;
                    postStatus("closed");
                }

                @Override
                public void onFailure(@NonNull WebSocket webSocket, @NonNull Throwable t, @Nullable Response response) {
                    socket = null;
                    attachedHostSessionId = null;
                    postStatus("error");
                    postError("ws failure: " + t.getMessage());
                }
            });

        } catch (Exception ex) {
            socket = null;
            attachedHostSessionId = null;
            postStatus("error");
            postError("connect error: " + ex.getMessage());
        }
    }

    private void handleIncoming(@NonNull String text) {
        try {
            JSONObject msg = new JSONObject(text);
            String type = msg.optString("type", "");

            if ("host.attached".equals(type)) {
                attachedHostSessionId = msg.optString("hostSessionId", attachedHostSessionId);
                postAttached(attachedHostSessionId);
                return;
            }

            if ("host.error".equals(type)) {
                postError("host error: " + msg.optString("error", "error"));
                return;
            }

            if ("script.started".equals(type)) {
                String hostId = msg.optString("hostSessionId", attachedHostSessionId);
                String scriptId = msg.optString("scriptInstanceId", "");
                String name = msg.optString("name", null);
                postScriptStarted(hostId, scriptId, name);
                return;
            }

            if ("ui.snapshot".equals(type)) {
                String hostId = msg.optString("hostSessionId", attachedHostSessionId);
                String scriptId = msg.optString("scriptInstanceId", "");
                int rev = msg.optInt("rev", 0);

                ScriptTree tree = null;
                JSONObject root = msg.optJSONObject("root");
                if (root != null) {
                    ScriptNode node = decodeNode(root);
                    Map<String, Object> metadata = toMap(msg.opt("metadata"));
                    tree = new ScriptTree(node, metadata);
                }
                postUiSnapshot(hostId, scriptId, rev, tree);
                return;
            }

            if ("script.error".equals(type)) {
                postError("script error: " + msg.optString("error", "error"));
                return;
            }

            if ("error".equals(type)) {
                postError(String.valueOf(msg.opt("error")));
            }

        } catch (Exception ignored) {
        }
    }

    // --- decoding (best-effort) ---

    private ScriptNode decodeNode(@NonNull JSONObject obj) {
        try {
            String id = obj.optString("id", "");
            String typeRaw = obj.optString("type", "");
            ScriptNodeType type = ScriptNodeType.fromRaw(typeRaw);
            if (type == null) type = ScriptNodeType.COLUMN;

            Map<String, Object> rawProps = toMap(obj.opt("props"));
            Map<ScriptEventType, String> handlers = new HashMap<>();
            JSONObject h = obj.optJSONObject("handlers");
            if (h != null) {
                Iterator<String> keys = h.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    ScriptEventType ev = ScriptEventType.fromRaw(k);
                    if (ev != null) {
                        String token = h.optString(k, null);
                        if (token != null) {
                            handlers.put(ev, token);
                        }
                    }
                }
            }

            ScriptNodeProps props = new ScriptNodeProps(rawProps, handlers);

            List<ScriptNode> children = new ArrayList<>();
            JSONArray kids = obj.optJSONArray("children");
            if (kids != null) {
                for (int i = 0; i < kids.length(); i++) {
                    Object it = kids.opt(i);
                    if (it instanceof JSONObject) {
                        children.add(decodeNode((JSONObject) it));
                    }
                }
            }

            return new ScriptNode(id, type, props, children);
        } catch (Exception ex) {
            // Empty fallback.
            return new ScriptNode("", ScriptNodeType.COLUMN, new ScriptNodeProps(new HashMap<>(), new HashMap<>()), new ArrayList<>());
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toMap(@Nullable Object v) {
        if (v == null || v == JSONObject.NULL) return new HashMap<>();
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v;
            Map<String, Object> out = new HashMap<>();
            Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(k, unwrapJson(o.opt(k)));
            }
            return out;
        }
        if (v instanceof Map) {
            return (Map<String, Object>) v;
        }
        return new HashMap<>();
    }

    private Object unwrapJson(@Nullable Object v) {
        if (v == null || v == JSONObject.NULL) return null;
        if (v instanceof JSONObject) {
            Map<String, Object> out = new HashMap<>();
            JSONObject o = (JSONObject) v;
            Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(k, unwrapJson(o.opt(k)));
            }
            return out;
        }
        if (v instanceof JSONArray) {
            JSONArray a = (JSONArray) v;
            List<Object> out = new ArrayList<>();
            for (int i = 0; i < a.length(); i++) {
                out.add(unwrapJson(a.opt(i)));
            }
            return out;
        }
        return v;
    }

    private Object wrapJson(@NonNull Object v) {
        // JSONObject/JSONArray will accept primitives, Strings, JSONObjects, JSONArrays.
        // For Map/List, wrap recursively.
        try {
            if (v instanceof Map) {
                JSONObject o = new JSONObject();
                Map<?, ?> m = (Map<?, ?>) v;
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    String k = String.valueOf(e.getKey());
                    Object vv = e.getValue();
                    if (vv == null) {
                        o.put(k, JSONObject.NULL);
                    } else {
                        o.put(k, wrapJson(vv));
                    }
                }
                return o;
            }
            if (v instanceof List) {
                JSONArray a = new JSONArray();
                for (Object it : (List<?>) v) {
                    if (it == null) a.put(JSONObject.NULL);
                    else a.put(wrapJson(it));
                }
                return a;
            }
        } catch (Exception ignored) {
        }
        return v;
    }

    private void postStatus(@NonNull String status) {
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) mainHandler.post(() -> d.onStatus(status));
    }

    private void postAttached(@NonNull String hostSessionId) {
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) mainHandler.post(() -> d.onAttached(hostSessionId));
    }

    private void postScriptStarted(@NonNull String hostSessionId, @NonNull String scriptInstanceId, @Nullable String name) {
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) mainHandler.post(() -> d.onScriptStarted(hostSessionId, scriptInstanceId, name));
    }

    private void postUiSnapshot(@NonNull String hostSessionId, @NonNull String scriptInstanceId, int rev, @Nullable ScriptTree tree) {
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) mainHandler.post(() -> d.onUiSnapshot(hostSessionId, scriptInstanceId, rev, tree));
    }

    private void postError(@NonNull String message) {
        Delegate d = delegateRef != null ? delegateRef.get() : null;
        if (d != null) mainHandler.post(() -> d.onError(message));
    }
}
