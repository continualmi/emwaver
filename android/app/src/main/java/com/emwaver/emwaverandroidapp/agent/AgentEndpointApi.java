/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class AgentEndpointApi {

    public static final class Conversation {
        @NonNull public final String id;
        @Nullable public final String title;
        public final long createdAtMs;
        public final long updatedAtMs;

        public Conversation(@NonNull String id, @Nullable String title, long createdAtMs, long updatedAtMs) {
            this.id = id;
            this.title = title;
            this.createdAtMs = createdAtMs;
            this.updatedAtMs = updatedAtMs;
        }

        @NonNull
        public String displayTitle() {
            String t = title != null ? title.trim() : "";
            return !t.isEmpty() ? t : id;
        }
    }

    public static final class Message {
        @NonNull public final String id;
        @NonNull public final String role;
        @NonNull public final String content;
        public final long createdAtMs;

        public Message(@NonNull String id, @NonNull String role, @NonNull String content, long createdAtMs) {
            this.id = id;
            this.role = role;
            this.content = content;
            this.createdAtMs = createdAtMs;
        }
    }

    public interface StreamListener {
        void onDelta(@NonNull String text);
        void onDone(@NonNull Message message, @Nullable String model);
        void onError(@NonNull String error);
    }

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient http;

    public AgentEndpointApi(@NonNull OkHttpClient http) {
        this.http = http;
    }

    @NonNull
    private static Request.Builder auth(@NonNull Request.Builder b, @NonNull String apiKey) {
        if (!apiKey.trim().isEmpty()) {
            b.header("Authorization", "Bearer " + apiKey.trim());
        }
        return b;
    }

    @NonNull
    public List<Conversation> listConversations(@NonNull String endpoint, @NonNull String apiKey) {
        return new ArrayList<>();
    }

    @NonNull
    public Conversation createConversation(@NonNull String endpoint, @NonNull String apiKey, @Nullable String title) {
        long now = System.currentTimeMillis();
        String trimmed = title != null ? title.trim() : "";
        if (trimmed.length() > 48) {
            trimmed = trimmed.substring(0, 48).trim();
        }
        return new Conversation(
                UUID.randomUUID().toString(),
                trimmed.isEmpty() ? "Chat" : trimmed,
                now,
                now
        );
    }

    public void deleteConversation(@NonNull String endpoint, @NonNull String apiKey, @NonNull String conversationId) {
        // Conversations are local UI state in the open-source app.
    }

    @NonNull
    public List<Message> listMessages(@NonNull String endpoint, @NonNull String apiKey, @NonNull String conversationId) {
        return new ArrayList<>();
    }

    public void chatStream(
            @NonNull String endpoint,
            @NonNull String apiKey,
            @NonNull String conversationId,
            @NonNull String message,
            @NonNull StreamListener listener
    ) {
        String trimmedEndpoint = endpoint.trim();
        if (trimmedEndpoint.isEmpty()) {
            listener.onError("Agent endpoint is not configured.");
            return;
        }
        if (apiKey.trim().isEmpty()) {
            listener.onError("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
            return;
        }

        JSONObject payload = new JSONObject();
        try {
            String universe = firstNonEmpty(
                    System.getenv("EMWAVER_AGENT_UNIVERSE"),
                    System.getenv("CONTINUAL_AGENT_UNIVERSE")
            );
            if (!universe.isEmpty()) {
                payload.put("universe", universe);
            }
            payload.put("userInput", message);
        } catch (Exception e) {
            listener.onError(e.toString());
            return;
        }

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
                    String body = response.body() != null ? response.body().string() : "";
                    if (response.code() == 401) {
                        listener.onError("Saved Agent key is not authorized.");
                        return;
                    }
                    if (!response.isSuccessful()) {
                        listener.onError(extractError(body, response.code()));
                        return;
                    }

                    JSONObject obj = new JSONObject(body);
                    String content = formatResponse(obj);
                    listener.onDone(new Message(
                            UUID.randomUUID().toString(),
                            "assistant",
                            content,
                            System.currentTimeMillis()
                    ), null);
                } catch (Exception e) {
                    listener.onError(e.toString());
                } finally {
                    response.close();
                }
            }
        });
    }

    @NonNull
    private static String formatResponse(@NonNull JSONObject obj) {
        List<String> pieces = new ArrayList<>();
        String message = obj.optString("message", "").trim();
        String code = obj.optString("code", "").trim();
        String patch = obj.optString("patch", "").trim();

        if (!message.isEmpty()) pieces.add(message);
        if (!code.isEmpty()) pieces.add("```emw\n" + code + "\n```");
        if (!patch.isEmpty()) pieces.add("Patch:\n" + patch);

        JSONArray warnings = obj.optJSONArray("warnings");
        if (warnings != null && warnings.length() > 0) {
            StringBuilder out = new StringBuilder("Warnings:");
            for (int i = 0; i < warnings.length(); i++) {
                String warning = warnings.optString(i, "").trim();
                if (!warning.isEmpty()) out.append("\n- ").append(warning);
            }
            pieces.add(out.toString());
        }

        if (pieces.isEmpty()) return "Agent returned an empty reply.";
        return String.join("\n\n", pieces);
    }

    @NonNull
    private static String extractError(@NonNull String body, int code) {
        try {
            JSONObject obj = new JSONObject(body);
            String message = obj.optString("message", "").trim();
            if (!message.isEmpty()) return message;
            String error = obj.optString("error", "").trim();
            if (!error.isEmpty()) return error;
        } catch (Exception ignored) {}
        String trimmed = body.trim();
        return !trimmed.isEmpty() ? trimmed : ("HTTP " + code);
    }

    @NonNull
    private static String firstNonEmpty(@Nullable String first, @Nullable String second) {
        String a = first != null ? first.trim() : "";
        if (!a.isEmpty()) return a;
        String b = second != null ? second.trim() : "";
        return b;
    }

    public static final class UnauthorizedException extends Exception {}
    public static final class ServerErrorException extends Exception {
        public ServerErrorException(@NonNull String message) { super(message); }
    }
}
