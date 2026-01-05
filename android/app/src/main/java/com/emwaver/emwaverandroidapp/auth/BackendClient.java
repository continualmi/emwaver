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

package com.emwaver.emwaverandroidapp.auth;

import android.content.Context;
import android.text.TextUtils;

import com.emwaver.emwaverandroidapp.BuildConfig;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class BackendClient {

    public static class BackendException extends Exception {
        public BackendException(String message) {
            super(message);
        }

        public BackendException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public static class LoginResult {
        public final String accessToken;
        public final String refreshToken;
        public final JSONObject user;
        public final JSONObject entitlement;

        LoginResult(String accessToken, String refreshToken, JSONObject user, JSONObject entitlement) {
            this.accessToken = accessToken;
            this.refreshToken = refreshToken;
            this.user = user;
            this.entitlement = entitlement;
        }
    }

    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");

    private static BackendClient instance;

    private final OkHttpClient httpClient;
    private final String baseUrl;

    private BackendClient(Context context) {
        this.httpClient = new OkHttpClient();
        String configuredBaseUrl = BuildConfig.BACKEND_BASE_URL;
        if (TextUtils.isEmpty(configuredBaseUrl)) {
            configuredBaseUrl = "http://10.0.2.2:8000";
        }
        this.baseUrl = configuredBaseUrl.endsWith("/")
                ? configuredBaseUrl.substring(0, configuredBaseUrl.length() - 1)
                : configuredBaseUrl;
    }

    public static synchronized BackendClient getInstance(Context context) {
        if (instance == null) {
            instance = new BackendClient(context.getApplicationContext());
        }
        return instance;
    }

    public LoginResult login(String email, String password) throws BackendException {
        JSONObject payload = new JSONObject();
        try {
            payload.put("email", email);
            payload.put("password", password);
        } catch (JSONException e) {
            throw new BackendException("Failed to build login payload", e);
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON_MEDIA_TYPE);
        Request request = new Request.Builder()
                .url(baseUrl + "/auth/login")
                .post(body)
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : null;
                String message = parseErrorMessage(errorBody);
                if (TextUtils.isEmpty(message)) {
                    message = "Login failed with status " + response.code();
                }
                throw new BackendException(message);
            }

            if (response.body() == null) {
                throw new BackendException("Empty response from server");
            }

            String bodyString = response.body().string();
            try {
                JSONObject json = new JSONObject(bodyString);
                String accessToken = json.optString("access_token", null);
                String refreshToken = json.optString("refresh_token", null);
                JSONObject user = json.optJSONObject("user");
                JSONObject entitlement = json.optJSONObject("entitlement");
                if (TextUtils.isEmpty(accessToken) || TextUtils.isEmpty(refreshToken) || user == null) {
                    throw new BackendException("Malformed response from server");
                }
                return new LoginResult(accessToken, refreshToken, user, entitlement);
            } catch (JSONException e) {
                throw new BackendException("Invalid response from server", e);
            }
        } catch (IOException e) {
            throw new BackendException("Unable to reach backend", e);
        }
    }

    public LoginResult register(
            String email,
            String username,
            String password,
            String firstName,
            String lastName,
            String accessCode
    )
            throws BackendException {
        JSONObject payload = new JSONObject();
        try {
            payload.put("email", email);
            payload.put("username", username);
            payload.put("password", password);
            if (!TextUtils.isEmpty(firstName)) {
                payload.put("first_name", firstName);
            }
            if (!TextUtils.isEmpty(lastName)) {
                payload.put("last_name", lastName);
            }
            if (!TextUtils.isEmpty(accessCode)) {
                payload.put("access_code", accessCode);
            }
        } catch (JSONException e) {
            throw new BackendException("Failed to build register payload", e);
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON_MEDIA_TYPE);
        Request request = new Request.Builder()
                .url(baseUrl + "/auth/register")
                .post(body)
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : null;
                String message = parseErrorMessage(errorBody);
                if (TextUtils.isEmpty(message)) {
                    message = "Registration failed with status " + response.code();
                }
                throw new BackendException(message);
            }

            if (response.body() == null) {
                throw new BackendException("Empty response from server");
            }

            String bodyString = response.body().string();
            try {
                JSONObject json = new JSONObject(bodyString);
                String accessToken = json.optString("access_token", null);
                String refreshToken = json.optString("refresh_token", null);
                JSONObject user = json.optJSONObject("user");
                JSONObject entitlement = json.optJSONObject("entitlement");
                if (TextUtils.isEmpty(accessToken) || TextUtils.isEmpty(refreshToken) || user == null) {
                    throw new BackendException("Malformed response from server");
                }
                return new LoginResult(accessToken, refreshToken, user, entitlement);
            } catch (JSONException e) {
                throw new BackendException("Invalid response from server", e);
            }
        } catch (IOException e) {
            throw new BackendException("Unable to reach backend", e);
        }
    }

    private String parseErrorMessage(String rawBody) {
        if (TextUtils.isEmpty(rawBody)) {
            return null;
        }
        try {
            JSONObject json = new JSONObject(rawBody);
            if (json.has("message")) {
                return json.getString("message");
            }
            if (json.has("error")) {
                return json.getString("error");
            }
        } catch (JSONException ignore) {
            // ignore and fall back to raw body
        }
        return rawBody;
    }
}
