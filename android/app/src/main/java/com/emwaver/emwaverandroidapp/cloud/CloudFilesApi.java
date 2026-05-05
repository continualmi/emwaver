/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class CloudFilesApi {
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private final OkHttpClient http;

    public CloudFilesApi(OkHttpClient http) {
        this.http = http;
    }

    private static void addAuthHeader(Request.Builder b, String accessToken) {
        if (accessToken != null && !accessToken.trim().isEmpty()) {
            b.header("Authorization", "Bearer " + accessToken.trim());
        }
    }

    public List<CloudUserFile> listFiles(String baseUrl, String accessToken) throws IOException {
        String url = baseUrl + "/v1/files";
        Request.Builder b = new Request.Builder().url(url).get().header("Accept", "application/json");
        addAuthHeader(b, accessToken);

        try (Response res = http.newCall(b.build()).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException("List failed: HTTP " + res.code() + " " + body);
            }

            try {
                JSONObject root = new JSONObject(body);
                JSONArray files = root.optJSONArray("files");
                List<CloudUserFile> out = new ArrayList<>();
                if (files != null) {
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject f = files.optJSONObject(i);
                        if (f == null) continue;
                        String name = f.optString("name", "");
                        if (name.isEmpty()) continue;
                        String etag = f.optString("etag", "");
                        long mtimeMs = f.optLong("mtime_ms", 0);
                        long sizeBytes = f.optLong("size_bytes", 0);
                        String contentType = f.optString("content_type", null);
                        out.add(new CloudUserFile(name, etag, mtimeMs, sizeBytes, contentType));
                    }
                }
                return out;
            } catch (JSONException e) {
                throw new IOException("List invalid JSON: " + e.getMessage());
            }
        }
    }

    public CloudUserFile uploadViaBackend(String baseUrl, String accessToken, String name, String contentType, byte[] bytes, long mtimeMs) throws IOException {
        String url = baseUrl + "/v1/files/upload";

        JSONObject payload = new JSONObject();
        try {
            payload.put("name", name);
            payload.put("content_type", contentType);
            payload.put("data_base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            payload.put("mtime_ms", mtimeMs);
        } catch (JSONException e) {
            throw new IOException("Upload payload JSON failed: " + e.getMessage());
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON);
        Request.Builder b = new Request.Builder().url(url).post(body).header("Accept", "application/json");
        addAuthHeader(b, accessToken);

        try (Response res = http.newCall(b.build()).execute()) {
            String resBody = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException("Upload failed: HTTP " + res.code() + " " + resBody);
            }

            try {
                JSONObject root = new JSONObject(resBody);
                JSONObject f = root.optJSONObject("file");
                if (f == null) {
                    return new CloudUserFile(name, "", mtimeMs, bytes.length, contentType);
                }
                String rName = f.optString("name", name);
                String etag = f.optString("etag", "");
                long rMtime = f.optLong("mtime_ms", mtimeMs);
                long sizeBytes = f.optLong("size_bytes", bytes.length);
                String ct = f.optString("content_type", contentType);
                return new CloudUserFile(rName, etag, rMtime, sizeBytes, ct);
            } catch (JSONException e) {
                throw new IOException("Upload invalid JSON: " + e.getMessage());
            }
        }
    }

    public byte[] downloadContentViaBackend(String baseUrl, String accessToken, String name) throws IOException {
        String url = baseUrl + "/v1/files/content?name=" + java.net.URLEncoder.encode(name, "UTF-8");
        Request.Builder b = new Request.Builder().url(url).get();
        addAuthHeader(b, accessToken);

        try (Response res = http.newCall(b.build()).execute()) {
            byte[] bytes = res.body() != null ? res.body().bytes() : new byte[0];
            if (!res.isSuccessful()) {
                String msg = new String(bytes);
                throw new IOException("Download failed: HTTP " + res.code() + " " + msg);
            }
            return bytes;
        }
    }

    public void deleteViaBackend(String baseUrl, String accessToken, String name) throws IOException {
        String url = baseUrl + "/v1/files?name=" + java.net.URLEncoder.encode(name, "UTF-8");
        Request.Builder b = new Request.Builder().url(url).delete().header("Accept", "application/json");
        addAuthHeader(b, accessToken);

        try (Response res = http.newCall(b.build()).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException("Delete failed: HTTP " + res.code() + " " + body);
            }
        }
    }
}
