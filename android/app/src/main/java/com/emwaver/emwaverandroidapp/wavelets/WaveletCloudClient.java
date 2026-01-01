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

package com.emwaver.emwaverandroidapp.wavelets;

import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.BuildConfig;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class WaveletCloudClient {

    public interface UploadCallback {
        void onSuccess();

        void onFailure(String message);
    }

    private static final String TAG = "WaveletCloudClient";
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient();

    private final String baseUrl;

    public WaveletCloudClient() {
        String configuredBaseUrl = BuildConfig.BACKEND_BASE_URL;
        if (TextUtils.isEmpty(configuredBaseUrl)) {
            configuredBaseUrl = "http://10.0.2.2:8000";
        }
        baseUrl = configuredBaseUrl.endsWith("/")
            ? configuredBaseUrl.substring(0, configuredBaseUrl.length() - 1)
            : configuredBaseUrl;
    }

    public void uploadWavelet(String accessToken, String name, String content, @Nullable String metadataJson, UploadCallback callback) {
        if (TextUtils.isEmpty(accessToken)) {
            callback.onFailure("Missing access token");
            return;
        }
        JSONObject payload = new JSONObject();
        try {
            payload.put("name", name);
            payload.put("content", content);
            if (!TextUtils.isEmpty(metadataJson)) {
                payload.put("metadata", new JSONObject(metadataJson));
            }
        } catch (JSONException e) {
            callback.onFailure("Failed to build payload");
            return;
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON_MEDIA_TYPE);
        Request request = new Request.Builder()
            .url(baseUrl + "/wavelets")
            .addHeader("Authorization", "Bearer " + accessToken)
            .addHeader("Content-Type", "application/json")
            .post(body)
            .build();

        HTTP_CLIENT.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(@Nullable Call call, @NonNull IOException e) {
                Log.e(TAG, "Wavelet upload failed", e);
                callback.onFailure(e.getMessage());
            }

            @Override
            public void onResponse(@NonNull Call call, @NonNull Response response) {
                try (Response res = response) {
                    if (!res.isSuccessful()) {
                        String message = "HTTP " + res.code();
                        Log.e(TAG, "Wavelet upload failed: " + message);
                        callback.onFailure(message);
                        return;
                    }
                    callback.onSuccess();
                }
            }
        });
    }
}
