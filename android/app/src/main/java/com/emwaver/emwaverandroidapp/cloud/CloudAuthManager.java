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

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Simple auth helper for Android.
 *
 * Source of truth is the EMWaver API key created on the web account page.
 */
public final class CloudAuthManager {
    private static final String PREFS = "emwaver.auth";
    private static final String KEY_API_KEY = "api_key";
    private static final String KEY_EMAIL = "email";
    private static final String KEY_NAME = "name";

    public interface SignInCallback {
        void onResult(boolean success, @Nullable String errorMessage);
    }

    private static volatile CloudAuthManager instance;

    private final OkHttpClient http = new OkHttpClient.Builder().build();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    @Nullable private Context appContext;

    private CloudAuthManager() {}

    public static CloudAuthManager getInstance() {
        if (instance == null) {
            synchronized (CloudAuthManager.class) {
                if (instance == null) {
                    instance = new CloudAuthManager();
                }
            }
        }
        return instance;
    }

    public void ensureInitialized(@NonNull Context context) {
        appContext = context.getApplicationContext();
    }

    private SharedPreferences prefs(@NonNull Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Nullable
    private Context requireContext() {
        return appContext;
    }

    public boolean isSignedIn() {
        Context context = requireContext();
        return context != null && isSignedIn(context);
    }

    public boolean isSignedIn(@NonNull Context context) {
        return !prefs(context).getString(KEY_API_KEY, "").trim().isEmpty();
    }

    @Nullable
    public String getSignedInEmail(@NonNull Context context) {
        return prefs(context).getString(KEY_EMAIL, null);
    }

    @Nullable
    public String getSignedInEmail() {
        Context context = requireContext();
        return context != null ? getSignedInEmail(context) : null;
    }

    @Nullable
    public String getSignedInDisplayName(@NonNull Context context) {
        return prefs(context).getString(KEY_NAME, null);
    }

    @Nullable
    public String getSignedInDisplayName() {
        Context context = requireContext();
        return context != null ? getSignedInDisplayName(context) : null;
    }

    public void saveApiKeyAsync(
            @NonNull Context context,
            @Nullable String apiKey,
            @NonNull SignInCallback callback
    ) {
        final String trimmed = apiKey == null ? "" : apiKey.trim();
        if (trimmed.isEmpty()) {
            callback.onResult(false, "Enter an EMWaver API key");
            return;
        }

        new Thread(() -> {
            try {
                SessionResult session = validateApiKey(context, trimmed);
                prefs(context).edit()
                        .putString(KEY_API_KEY, trimmed)
                        .putString(KEY_EMAIL, session.email)
                        .putString(KEY_NAME, session.name)
                        .apply();
                mainHandler.post(() -> callback.onResult(true, null));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Key validation failed";
                mainHandler.post(() -> callback.onResult(false, msg));
            }
        }).start();
    }

    private static final class SessionResult {
        final String email;
        final String name;

        SessionResult(String email, String name) {
            this.email = email;
            this.name = name;
        }
    }

    @NonNull
    private SessionResult validateApiKey(@NonNull Context context, @NonNull String apiKey) throws Exception {
        String url = CloudConfig.getBackendBaseUrl(context).trim() + "/v1/auth/key";

        Request req = new Request.Builder()
                .url(url)
                .get()
                .addHeader("Accept", "application/json")
                .addHeader("Authorization", "Bearer " + apiKey)
                .build();

        try (Response res = http.newCall(req).execute()) {
            String json = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException(json.isEmpty()
                        ? ("Key validation failed: HTTP " + res.code())
                        : json);
            }

            JSONObject root = new JSONObject(json);
            JSONObject user = root.optJSONObject("user");
            if (user == null && root.has("email")) {
                user = root;
            }
            if (user == null) {
                user = root.optJSONObject("account");
            }
            if (user == null) {
                throw new IOException("Missing user");
            }
            return new SessionResult(
                    user.optString("email", ""),
                    user.optString("name", user.optString("displayName", user.optString("display_name", "")))
            );
        }
    }

    /**
     * Returns the saved EMWaver API key for backend Authorization: Bearer <token>.
     * Returns "" when not signed in.
     */
    @NonNull
    public String getIdTokenBlocking(@NonNull Context context) {
        return prefs(context).getString(KEY_API_KEY, "");
    }

    @NonNull
    public String getIdTokenBlocking() {
        Context context = requireContext();
        return context != null ? getIdTokenBlocking(context) : "";
    }

    public void signOut(@NonNull Context context) {
        prefs(context).edit().clear().apply();
    }

    public void signOut() {
        Context context = requireContext();
        if (context != null) {
            signOut(context);
        }
    }
}
