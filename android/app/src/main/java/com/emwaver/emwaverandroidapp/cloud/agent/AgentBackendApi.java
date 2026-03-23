/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class AgentBackendApi {

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

    public AgentBackendApi(@NonNull OkHttpClient http) {
        this.http = http;
    }

    @NonNull
    private static String joinUrl(@NonNull String base, @NonNull String path) {
        String b = base.trim();
        if (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        String p = path.trim();
        if (!p.startsWith("/")) p = "/" + p;
        return b + p;
    }

    @NonNull
    private static Request.Builder auth(@NonNull Request.Builder b, @NonNull String idToken) {
        if (!idToken.trim().isEmpty()) {
            b.header("Authorization", "Bearer " + idToken.trim());
        }
        return b;
    }

    @NonNull
    public List<Conversation> listConversations(@NonNull String baseUrl, @NonNull String idToken) throws Exception {
        Request req = auth(new Request.Builder()
                        .url(joinUrl(baseUrl, "/v1/agent/conversations"))
                        .get()
                        .header("Accept", "application/json"),
                idToken).build();

        try (Response res = http.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (res.code() == 401) throw new UnauthorizedException();
            if (!res.isSuccessful()) throw new ServerErrorException(extractError(body, res.code()));

            JSONObject obj = new JSONObject(body);
            JSONArray arr = obj.optJSONArray("conversations");
            List<Conversation> out = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject c = arr.getJSONObject(i);
                    out.add(new Conversation(
                            c.getString("id"),
                            c.optString("title", null),
                            c.optLong("created_at_ms", 0),
                            c.optLong("updated_at_ms", 0)
                    ));
                }
            }
            return out;
        }
    }

    @NonNull
    public Conversation createConversation(@NonNull String baseUrl, @NonNull String idToken, @Nullable String title) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("title", title != null ? title.trim() : "");

        Request req = auth(new Request.Builder()
                        .url(joinUrl(baseUrl, "/v1/agent/conversations"))
                        .post(RequestBody.create(payload.toString(), JSON))
                        .header("Accept", "application/json"),
                idToken).build();

        try (Response res = http.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (res.code() == 401) throw new UnauthorizedException();
            if (!res.isSuccessful()) throw new ServerErrorException(extractError(body, res.code()));

            JSONObject obj = new JSONObject(body);
            JSONObject c = obj.getJSONObject("conversation");
            return new Conversation(
                    c.getString("id"),
                    c.optString("title", null),
                    c.optLong("created_at_ms", 0),
                    c.optLong("updated_at_ms", 0)
            );
        }
    }

    public void deleteConversation(@NonNull String baseUrl, @NonNull String idToken, @NonNull String conversationId) throws Exception {
        String url = joinUrl(baseUrl, "/v1/agent/conversations/" + conversationId);
        Request req = auth(new Request.Builder()
                        .url(url)
                        .delete()
                        .header("Accept", "application/json"),
                idToken).build();

        try (Response res = http.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (res.code() == 401) throw new UnauthorizedException();
            if (!res.isSuccessful()) throw new ServerErrorException(extractError(body, res.code()));
        }
    }

    @NonNull
    public List<Message> listMessages(@NonNull String baseUrl, @NonNull String idToken, @NonNull String conversationId) throws Exception {
        String url = joinUrl(baseUrl, "/v1/agent/conversations/" + conversationId + "/messages");
        Request req = auth(new Request.Builder()
                        .url(url)
                        .get()
                        .header("Accept", "application/json"),
                idToken).build();

        try (Response res = http.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (res.code() == 401) throw new UnauthorizedException();
            if (!res.isSuccessful()) throw new ServerErrorException(extractError(body, res.code()));

            JSONObject obj = new JSONObject(body);
            JSONArray arr = obj.optJSONArray("messages");
            List<Message> out = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject m = arr.getJSONObject(i);
                    out.add(new Message(
                            m.optString("id", "" + i),
                            m.optString("role", "assistant"),
                            m.optString("content", ""),
                            m.optLong("created_at_ms", 0)
                    ));
                }
            }
            return out;
        }
    }

    public void chatStream(
            @NonNull String baseUrl,
            @NonNull String idToken,
            @NonNull String conversationId,
            @NonNull String message,
            @NonNull StreamListener listener
    ) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("conversation_id", conversationId);
            payload.put("message", message);
        } catch (Exception e) {
            listener.onError(e.toString());
            return;
        }

        Request req = auth(new Request.Builder()
                        .url(joinUrl(baseUrl, "/v1/agent/chat/stream_tools"))
                        .post(RequestBody.create(payload.toString(), JSON))
                        .header("Accept", "text/event-stream"),
                idToken).build();

        http.newCall(req).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(@NonNull okhttp3.Call call, @NonNull java.io.IOException e) {
                listener.onError(e.toString());
            }

            @Override
            public void onResponse(@NonNull okhttp3.Call call, @NonNull Response response) {
                if (response.code() == 401) {
                    listener.onError("Unauthorized");
                    response.close();
                    return;
                }
                if (!response.isSuccessful()) {
                    String body = "";
                    try {
                        body = response.body() != null ? response.body().string() : "";
                    } catch (Exception ignored) {}
                    listener.onError(extractError(body, response.code()));
                    response.close();
                    return;
                }

                try {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(
                            response.body().byteStream(), StandardCharsets.UTF_8
                    ));

                    StringBuilder block = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            parseBlock(block.toString(), listener);
                            block.setLength(0);
                        } else {
                            block.append(line).append("\n");
                        }
                    }
                    if (block.length() > 0) {
                        parseBlock(block.toString(), listener);
                    }
                } catch (Exception e) {
                    listener.onError(e.toString());
                } finally {
                    response.close();
                }
            }
        });
    }

    private static void parseBlock(@NonNull String raw, @NonNull StreamListener listener) {
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return;

        String event = "message";
        List<String> dataLines = new ArrayList<>();

        String[] lines = trimmed.split("\\n");
        for (String ln : lines) {
            if (ln.startsWith("event:")) {
                event = ln.substring("event:".length()).trim();
            } else if (ln.startsWith("data:")) {
                dataLines.add(ln.substring("data:".length()).trim());
            }
        }

        String dataRaw = android.text.TextUtils.join("\n", dataLines).trim();
        if (dataRaw.isEmpty()) return;

        try {
            JSONObject obj = new JSONObject(dataRaw);
            if ("delta".equals(event)) {
                listener.onDelta(obj.optString("text", ""));
                return;
            }
            if ("error".equals(event)) {
                listener.onError(obj.optString("error", "error"));
                return;
            }
            if ("done".equals(event)) {
                JSONObject msg = obj.getJSONObject("message");
                Message m = new Message(
                        msg.optString("id", ""),
                        msg.optString("role", "assistant"),
                        msg.optString("content", ""),
                        msg.optLong("created_at_ms", 0)
                );
                listener.onDone(m, obj.optString("model", null));
            }
        } catch (Exception e) {
            listener.onError(e.toString());
        }
    }

    @NonNull
    private static String extractError(@NonNull String body, int statusCode) {
        try {
            JSONObject obj = new JSONObject(body);
            String err = obj.optString("error", "");
            if (!err.trim().isEmpty()) return err;
        } catch (Exception ignored) {}

        String msg = body.trim();
        if (!msg.isEmpty()) return msg;
        return "HTTP " + statusCode;
    }

    public static final class UnauthorizedException extends Exception {}

    public static final class ServerErrorException extends Exception {
        public ServerErrorException(@NonNull String message) { super(message); }
    }
}
