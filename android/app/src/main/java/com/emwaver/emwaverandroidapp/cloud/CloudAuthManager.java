/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Simple auth helper for Android.
 *
 * Source of truth is the EMWaver access token issued after a Continual handoff.
 */
public final class CloudAuthManager {
    private static final String PREFS = "emwaver.auth";
    private static final String KEY_ACCESS_TOKEN = "access_token";
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
        return !prefs(context).getString(KEY_ACCESS_TOKEN, "").trim().isEmpty();
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

    public void beginWebSignIn(@NonNull Context context) {
        String url = "https://continualmi.com/emwaver/handoff";
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(browser);
    }

    public void consumeWebHandoffCodeAsync(
            @NonNull Context context,
            @Nullable String code,
            @NonNull SignInCallback callback
    ) {
        final String trimmed = code == null ? "" : code.trim().toUpperCase();
        if (trimmed.isEmpty()) {
            callback.onResult(false, "Missing handoff code");
            return;
        }

        new Thread(() -> {
            try {
                SessionResult session = fetchAccessToken(context, trimmed);
                prefs(context).edit()
                        .putString(KEY_ACCESS_TOKEN, session.accessToken)
                        .putString(KEY_EMAIL, session.email)
                        .putString(KEY_NAME, session.name)
                        .apply();
                mainHandler.post(() -> callback.onResult(true, null));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Sign in failed";
                mainHandler.post(() -> callback.onResult(false, msg));
            }
        }).start();
    }

    @NonNull
    private static final class SessionResult {
        final String accessToken;
        final String email;
        final String name;

        SessionResult(String accessToken, String email, String name) {
            this.accessToken = accessToken;
            this.email = email;
            this.name = name;
        }
    }

    @NonNull
    private SessionResult fetchAccessToken(@NonNull Context context, @NonNull String code) throws Exception {
        String url = CloudConfig.getBackendBaseUrl(context).trim() + "/v1/auth/handoff/consume";
        JSONObject payload = new JSONObject();
        payload.put("code", code);

        RequestBody body = RequestBody.create(
                payload.toString(),
                MediaType.parse("application/json")
        );

        Request req = new Request.Builder()
                .url(url)
                .post(body)
                .build();

        try (Response res = http.newCall(req).execute()) {
            String json = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException(json.isEmpty()
                        ? ("Handoff consume failed: HTTP " + res.code())
                        : json);
            }

            JSONObject root = new JSONObject(json);
            String accessToken = root.optString("access_token", "");
            if (accessToken.isEmpty()) {
                throw new IOException("Missing access_token");
            }
            JSONObject user = root.optJSONObject("user");
            return new SessionResult(
                    accessToken,
                    user != null ? user.optString("email", "") : "",
                    user != null ? user.optString("name", "") : ""
            );
        }
    }

    /**
     * Returns a Firebase ID token for backend Authorization: Bearer <token>.
     * Returns "" when not signed in.
     */
    @NonNull
    public String getIdTokenBlocking(@NonNull Context context) {
        return prefs(context).getString(KEY_ACCESS_TOKEN, "");
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
