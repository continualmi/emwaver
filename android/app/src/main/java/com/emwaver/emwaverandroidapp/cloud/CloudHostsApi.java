/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.cloud;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public final class CloudHostsApi {
    private final OkHttpClient http;

    public CloudHostsApi(OkHttpClient http) {
        this.http = http;
    }

    private static void addAuthHeader(Request.Builder b, String accessToken) {
        if (accessToken != null && !accessToken.trim().isEmpty()) {
            b.header("Authorization", "Bearer " + accessToken.trim());
        }
    }

    public List<HostSession> listHosts(String baseUrl, String accessToken) throws IOException {
        String url = baseUrl + "/v1/hosts";
        Request.Builder b = new Request.Builder().url(url).get().header("Accept", "application/json");
        addAuthHeader(b, accessToken);

        try (Response res = http.newCall(b.build()).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException("List hosts failed: HTTP " + res.code() + " " + body);
            }

            try {
                JSONObject root = new JSONObject(body);
                JSONArray arr = root.optJSONArray("hosts");
                List<HostSession> out = new ArrayList<>();
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject h = arr.optJSONObject(i);
                        if (h == null) continue;
                        out.add(HostSession.fromJson(h));
                    }
                }
                return out;
            } catch (JSONException e) {
                throw new IOException("List hosts invalid JSON: " + e.getMessage());
            }
        }
    }
}
