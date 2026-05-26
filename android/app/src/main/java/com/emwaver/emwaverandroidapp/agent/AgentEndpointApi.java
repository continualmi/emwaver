/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class AgentEndpointApi {

    // ── Streaming listener ──────────────────────────────────────────

    public interface StreamListener {
        void onDelta(@NonNull String text);
        void onDone(@NonNull AgentChatMessage message, @Nullable String model);
        void onToolCalls(@NonNull List<AgentToolCall> toolCalls);
        void onError(@NonNull String error);
    }

    // ── Request / response payloads ─────────────────────────────────

    public static final class SendRequest {
        @Nullable public final String model;
        @NonNull  public final String universe;
        @NonNull  public final String userInput;
        @Nullable public final List<AgentToolDefinition> tools;
        @Nullable public final String toolChoice; // "auto", "none", or null
        @Nullable public final List<AgentToolResultData> toolResults;
        @Nullable public final String systemPrompt;

        public SendRequest(@Nullable String model, @NonNull String universe, @NonNull String userInput,
                           @Nullable List<AgentToolDefinition> tools, @Nullable String toolChoice,
                           @Nullable List<AgentToolResultData> toolResults, @Nullable String systemPrompt) {
            this.model = model;
            this.universe = universe;
            this.userInput = userInput;
            this.tools = tools;
            this.toolChoice = toolChoice;
            this.toolResults = toolResults;
            this.systemPrompt = systemPrompt;
        }
    }

    public static final class SendResponse {
        @Nullable public final String message;
        @Nullable public final String assistantRaw;
        @Nullable public final String code;
        @Nullable public final String patch;
        @Nullable public final List<String> warnings;
        @Nullable public final List<AgentToolCall> toolCalls;

        SendResponse(@Nullable String message, @Nullable String assistantRaw,
                     @Nullable String code, @Nullable String patch,
                     @Nullable List<String> warnings, @Nullable List<AgentToolCall> toolCalls) {
            this.message = message;
            this.assistantRaw = assistantRaw;
            this.code = code;
            this.patch = patch;
            this.warnings = warnings;
            this.toolCalls = toolCalls;
        }
    }

    public static final class ScriptContext {
        @Nullable public final String name;
        @Nullable public final String source;

        public ScriptContext(@Nullable String name, @Nullable String source) {
            this.name = name;
            this.source = source;
        }
    }

    // ── Instance ────────────────────────────────────────────────────

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient http;
    @Nullable private final AgentChatStore store;

    public AgentEndpointApi(@NonNull OkHttpClient http) {
        this.http = http;
        this.store = null;
    }

    public AgentEndpointApi(@NonNull Context context, @NonNull OkHttpClient http) {
        this.http = http;
        this.store = AgentChatStore.getInstance(context);
    }

    // ── Conversations (local store) ─────────────────────────────────

    @NonNull
    public List<AgentConversationInfo> listConversations(@NonNull String endpoint, @NonNull String apiKey) {
        return store != null ? store.listConversations() : new ArrayList<>();
    }

    @NonNull
    public AgentConversationInfo createConversation(@NonNull String endpoint, @NonNull String apiKey,
                                                     @Nullable String title) {
        if (store != null) return store.createConversation(title);
        long now = System.currentTimeMillis();
        return new AgentConversationInfo(UUID.randomUUID(), null, "Chat", now, now);
    }

    public void deleteConversation(@NonNull String endpoint, @NonNull String apiKey,
                                   @NonNull String conversationId) {
        if (store != null) store.archiveConversation(conversationId);
    }

    @NonNull
    public List<AgentChatMessage> listMessages(@NonNull String endpoint, @NonNull String apiKey,
                                               @NonNull String conversationId) {
        return store != null ? store.listMessages(conversationId) : new ArrayList<>();
    }

    // ── Universe creation ───────────────────────────────────────────

    @NonNull
    public String createUniverse(@NonNull String endpoint, @NonNull String apiKey,
                                 @NonNull String storedPrompt, @Nullable String displayName) throws Exception {
        String createUrl = universeCreateUrl(endpoint);
        JSONObject payload = new JSONObject();
        payload.put("storedPrompt", storedPrompt);
        if (displayName != null && !displayName.trim().isEmpty()) {
            payload.put("displayName", displayName.trim());
        }

        Request req = auth(new Request.Builder()
                        .url(createUrl)
                        .post(RequestBody.create(payload.toString(), JSON))
                        .header("Accept", "application/json"),
                apiKey).build();

        try (Response res = http.newCall(req).execute()) {
            String body = extractBody(res);
            if (res.code() == 401) throw new UnauthorizedException();
            if (!res.isSuccessful()) throw new ServerErrorException(extractError(body, res.code()));

            JSONObject obj = new JSONObject(body);
            String universe = obj.optString("universe", "").trim();
            if (universe.isEmpty()) throw new ServerErrorException("Invalid universe response");
            return universe;
        }
    }

    // ── Send (full request with tools) ──────────────────────────────

    public void send(@NonNull String endpoint, @NonNull String apiKey,
                     @NonNull SendRequest request, @NonNull StreamListener listener) {

        String trimmedEndpoint = endpoint.trim();
        if (trimmedEndpoint.isEmpty()) {
            listener.onError("Agent endpoint is not configured.");
            return;
        }
        if (apiKey.trim().isEmpty()) {
            listener.onError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
            return;
        }

        JSONObject payload = buildPayload(request);

        Request req = auth(new Request.Builder()
                        .url(trimmedEndpoint)
                        .post(RequestBody.create(payload.toString(), JSON))
                        .header("Accept", "application/json"),
                apiKey).build();

        http.newCall(req).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(@NonNull okhttp3.Call call, @NonNull java.io.IOException e) {
                listener.onError(e.toString());
            }

            @Override
            public void onResponse(@NonNull okhttp3.Call call, @NonNull Response response) {
                try {
                    String body = extractBody(response);
                    if (response.code() == 401) {
                        listener.onError("Saved Agent key is not authorized.");
                        return;
                    }
                    if (!response.isSuccessful()) {
                        listener.onError(extractError(body, response.code()));
                        return;
                    }

                    JSONObject obj = new JSONObject(body);
                    SendResponse parsed = parseResponse(obj);

                    // Check for tool calls first
                    if (parsed.toolCalls != null && !parsed.toolCalls.isEmpty()) {
                        listener.onToolCalls(parsed.toolCalls);
                        return;
                    }

                    // Regular text response — deliver in simulated streaming chunks
                    String content = formatResponse(parsed);
                    AgentChatMessage doneMsg = new AgentChatMessage(
                            AgentChatRole.ASSISTANT, content);
                    deliverChunked(content, doneMsg, listener);

                } catch (Exception e) {
                    listener.onError(e.toString());
                } finally {
                    response.close();
                }
            }
        });
    }

    // ── Chunked delivery (simulated streaming) ─────────────────────

    private static final long CHUNK_DELAY_MS = 16; // ~60fps typing feel
    private static final int WORDS_PER_CHUNK = 3;

    private void deliverChunked(@NonNull String text, @NonNull AgentChatMessage doneMsg,
                                @NonNull StreamListener listener) {
        if (text.isEmpty()) {
            listener.onDone(doneMsg, null);
            return;
        }

        // Split into words, then group into chunks
        String[] words = text.split(" ");
        List<String> chunks = new ArrayList<>();
        StringBuilder chunk = new StringBuilder();
        for (int i = 0; i < words.length; i++) {
            if (i > 0 && i % WORDS_PER_CHUNK == 0) {
                chunks.add(chunk.toString().trim());
                chunk.setLength(0);
            }
            if (chunk.length() > 0) chunk.append(' ');
            chunk.append(words[i]);
        }
        if (chunk.length() > 0) {
            chunks.add(chunk.toString().trim());
        }

        // Don't chunk short responses
        if (chunks.size() <= 1) {
            listener.onDelta(text);
            listener.onDone(doneMsg, null);
            return;
        }

        Handler mainHandler = new Handler(Looper.getMainLooper());
        final int[] index = {0};
        final StringBuilder accumulated = new StringBuilder();

        Runnable deliver = new Runnable() {
            @Override
            public void run() {
                if (index[0] >= chunks.size()) {
                    listener.onDone(doneMsg, null);
                    return;
                }

                String piece = chunks.get(index[0]);
                if (accumulated.length() > 0) accumulated.append(' ');
                accumulated.append(piece);
                listener.onDelta(accumulated.toString());
                index[0]++;

                if (index[0] >= chunks.size()) {
                    // Deliver final complete text via onDone
                    mainHandler.postDelayed(() -> listener.onDone(doneMsg, null), CHUNK_DELAY_MS);
                } else {
                    mainHandler.postDelayed(this, CHUNK_DELAY_MS);
                }
            }
        };

        // Start with an empty delta so the UI knows streaming has begun
        listener.onDelta("");
        mainHandler.post(deliver);
    }

    // ── payload builders ────────────────────────────────────────────

    @NonNull
    static JSONObject buildPayload(@NonNull SendRequest request) {
        JSONObject payload = new JSONObject();
        try {
            if (request.model != null && !request.model.trim().isEmpty()) {
                payload.put("model", request.model.trim());
            }
            payload.put("universe", request.universe);
            payload.put("userInput", request.userInput);

            if (request.tools != null && !request.tools.isEmpty()) {
                JSONArray toolsArr = new JSONArray();
                for (AgentToolDefinition td : request.tools) {
                    JSONObject tool = new JSONObject();
                    tool.put("type", "function");
                    tool.put("name", td.name);
                    if (td.description != null) tool.put("description", td.description);
                    if (td.parameters != null) tool.put("parameters", toolJsonToOrg(td.parameters));
                    toolsArr.put(tool);
                }
                payload.put("tools", toolsArr);
            }

            if (request.toolChoice != null && !request.toolChoice.trim().isEmpty()) {
                payload.put("toolChoice", request.toolChoice.trim());
            }

            if (request.toolResults != null && !request.toolResults.isEmpty()) {
                JSONArray resultsArr = new JSONArray();
                for (AgentToolResultData tr : request.toolResults) {
                    JSONObject result = new JSONObject();
                    if (tr.id != null) result.put("id", tr.id);
                    if (tr.callId != null) result.put("callId", tr.callId);
                    result.put("name", tr.name);
                    if (tr.arguments != null) result.put("arguments", toolJsonToOrg(tr.arguments));
                    if (tr.output != null) result.put("output", toolJsonToOrg(tr.output));
                    result.put("ok", tr.ok);
                    if (tr.result != null) result.put("result", toolJsonToOrg(tr.result));
                    if (tr.error != null) result.put("error", tr.error);
                    resultsArr.put(result);
                }
                payload.put("toolResults", resultsArr);
            }

            if (request.systemPrompt != null && !request.systemPrompt.trim().isEmpty()) {
                payload.put("systemPrompt", request.systemPrompt.trim());
            }
        } catch (Exception ignored) {}
        return payload;
    }

    @NonNull
    public static String buildUserInput(@Nullable String message, @Nullable String scriptName,
                                        @Nullable String scriptSource) {
        String text = message != null ? message.trim() : "";
        String source = scriptSource != null ? scriptSource.trim() : "";
        if (source.isEmpty()) return text;

        String name = (scriptName != null && !scriptName.trim().isEmpty())
                ? scriptName.trim() : "script.js";
        return text + "\n\nScript `" + name + "`:\n```emw\n" + source + "\n```";
    }

    @NonNull
    public static String buildUserInput(@Nullable String message, @Nullable ScriptContext scriptContext) {
        return buildUserInput(
                message,
                scriptContext != null ? scriptContext.name : null,
                scriptContext != null ? scriptContext.source : null);
    }

    // ── response helpers ────────────────────────────────────────────

    @NonNull
    static SendResponse parseResponse(@NonNull JSONObject obj) {
        String message = trimOrNull(obj.optString("message"));
        String assistantRaw = trimOrNull(obj.optString("assistantRaw"));
        String code = trimOrNull(obj.optString("code"));
        String patch = trimOrNull(obj.optString("patch"));

        List<String> warnings = null;
        JSONArray warnsArr = obj.optJSONArray("warnings");
        if (warnsArr != null && warnsArr.length() > 0) {
            warnings = new ArrayList<>();
            for (int i = 0; i < warnsArr.length(); i++) {
                String w = warnsArr.optString(i, "").trim();
                if (!w.isEmpty()) warnings.add(w);
            }
            if (warnings.isEmpty()) warnings = null;
        }

        List<AgentToolCall> toolCalls = null;
        JSONArray tcs = obj.optJSONArray("toolCalls");
        if (tcs != null && tcs.length() > 0) {
            toolCalls = new ArrayList<>();
            for (int i = 0; i < tcs.length(); i++) {
                JSONObject tc = tcs.optJSONObject(i);
                if (tc == null) continue;
                String tcId = trimOrNull(tc.optString("id"));
                String tcCallId = trimOrNull(tc.optString("callId"));
                String tcName = tc.optString("name", "").trim();
                if (tcName.isEmpty()) continue;
                Map<String, AgentToolJSON> args = parseToolJsonMap(tc.optJSONObject("arguments"));
                toolCalls.add(new AgentToolCall(tcId, tcCallId, tcName, args));
            }
            if (toolCalls.isEmpty()) toolCalls = null;
        }

        return new SendResponse(message, assistantRaw, code, patch, warnings, toolCalls);
    }

    @NonNull
    public static String formatResponse(@NonNull SendResponse response) {
        List<String> pieces = new ArrayList<>();
        if (response.message != null && !response.message.isEmpty())
            pieces.add(response.message);
        if (response.code != null && !response.code.isEmpty())
            pieces.add("```emw\n" + response.code + "\n```");
        if (response.patch != null && !response.patch.isEmpty())
            pieces.add("Patch:\n" + response.patch);
        if (response.warnings != null && !response.warnings.isEmpty()) {
            StringBuilder sb = new StringBuilder("Warnings:");
            for (String w : response.warnings) sb.append("\n- ").append(w);
            pieces.add(sb.toString());
        }
        if (pieces.isEmpty()) return "Agent returned an empty reply.";
        return String.join("\n\n", pieces);
    }

    // ── tool JSON parsing ───────────────────────────────────────────

    @Nullable
    public static Map<String, AgentToolJSON> parseToolJsonMap(@Nullable JSONObject obj) {
        if (obj == null) return null;
        Map<String, AgentToolJSON> map = new HashMap<>();
        Iterator<String> it = obj.keys();
        while (it.hasNext()) {
            String key = it.next();
            map.put(key, parseToolJson(obj.opt(key)));
        }
        return map.isEmpty() ? null : map;
    }

    @Nullable
    public static AgentToolJSON parseToolJson(@Nullable Object value) {
        if (value == null || JSONObject.NULL.equals(value)) return AgentToolJSON.NULL;
        if (value instanceof String) return AgentToolJSON.of((String) value);
        if (value instanceof Double) return AgentToolJSON.of((Double) value);
        if (value instanceof Integer) return AgentToolJSON.of(((Integer) value).doubleValue());
        if (value instanceof Long) return AgentToolJSON.of(((Long) value).doubleValue());
        if (value instanceof Boolean) return AgentToolJSON.of((Boolean) value);
        if (value instanceof JSONObject) {
            Map<String, AgentToolJSON> map = new HashMap<>();
            JSONObject obj = (JSONObject) value;
            Iterator<String> it = obj.keys();
            while (it.hasNext()) {
                String key = it.next();
                map.put(key, parseToolJson(obj.opt(key)));
            }
            return AgentToolJSON.of(map);
        }
        if (value instanceof JSONArray) {
            JSONArray arr = (JSONArray) value;
            List<AgentToolJSON> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                AgentToolJSON item = parseToolJson(arr.opt(i));
                if (item != null) list.add(item);
            }
            return AgentToolJSON.ofArray(list);
        }
        // Try number conversion
        if (value instanceof Number) {
            return AgentToolJSON.of(((Number) value).doubleValue());
        }
        return AgentToolJSON.of(String.valueOf(value));
    }

    static Object toolJsonToOrg(@NonNull Object value) {
        if (value instanceof Map) {
            JSONObject obj = new JSONObject();
            @SuppressWarnings("unchecked")
            Map<String, AgentToolJSON> map = (Map<String, AgentToolJSON>) value;
            for (Map.Entry<String, AgentToolJSON> e : map.entrySet()) {
                try { obj.put(e.getKey(), toolJsonToOrg(e.getValue())); } catch (Exception ignored) {}
            }
            return obj;
        }
        if (value instanceof List) {
            JSONArray arr = new JSONArray();
            for (Object item : (List<?>) value) {
                arr.put(toolJsonToOrg(item));
            }
            return arr;
        }
        if (value instanceof AgentToolJSON) return toolJsonToOrg(value);
        return value;
    }

    static Object toolJsonToOrg(@NonNull AgentToolJSON json) {
        if (json.isNull()) return JSONObject.NULL;
        if (json instanceof AgentToolJSON.StringValue) return ((AgentToolJSON.StringValue) json).value;
        if (json instanceof AgentToolJSON.NumberValue) return ((AgentToolJSON.NumberValue) json).value;
        if (json instanceof AgentToolJSON.BoolValue) return ((AgentToolJSON.BoolValue) json).value;
        if (json instanceof AgentToolJSON.ObjectValue) {
            JSONObject obj = new JSONObject();
            for (Map.Entry<String, AgentToolJSON> e : ((AgentToolJSON.ObjectValue) json).value.entrySet()) {
                try { obj.put(e.getKey(), toolJsonToOrg(e.getValue())); } catch (Exception ignored) {}
            }
            return obj;
        }
        if (json instanceof AgentToolJSON.ArrayValue) {
            JSONArray arr = new JSONArray();
            for (AgentToolJSON item : ((AgentToolJSON.ArrayValue) json).value) {
                arr.put(toolJsonToOrg(item));
            }
            return arr;
        }
        return JSONObject.NULL;
    }

    // ── HTTP helpers ────────────────────────────────────────────────

    @NonNull
    private static Request.Builder auth(@NonNull Request.Builder b, @NonNull String apiKey) {
        if (!apiKey.trim().isEmpty()) b.header("Authorization", "Bearer " + apiKey.trim());
        return b;
    }

    @NonNull
    private static String extractBody(@NonNull Response res) {
        try {
            ResponseBody b = res.body();
            return b != null ? b.string() : "";
        } catch (Exception e) {
            return "";
        }
    }

    @NonNull
    private static String extractError(@NonNull String body, int code) {
        try {
            JSONObject obj = new JSONObject(body);
            String message = trimOrNull(obj.optString("message"));
            if (message != null && !message.isEmpty()) return message;
            String error = trimOrNull(obj.optString("error"));
            if (error != null && !error.isEmpty()) return error;
        } catch (Exception ignored) {}
        String trimmed = body.trim();
        return !trimmed.isEmpty() ? trimmed : ("HTTP " + code);
    }

    @NonNull
    private static String universeCreateUrl(@NonNull String endpoint) {
        String url = endpoint.trim();
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (url.endsWith("/responses")) {
            url = url.substring(0, url.length() - "/responses".length());
        }
        return url + "/universes";
    }

    @Nullable
    private static String trimOrNull(@Nullable String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    // ── Exceptions ──────────────────────────────────────────────────

    public static final class UnauthorizedException extends Exception {}
    public static final class ServerErrorException extends Exception {
        public ServerErrorException(@NonNull String message) { super(message); }
    }
}
