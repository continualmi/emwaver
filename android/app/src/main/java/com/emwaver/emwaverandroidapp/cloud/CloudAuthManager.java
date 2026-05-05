/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Simple auth helper for Android.
 *
 * Source of truth is the Agent API key stored locally on this device.
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
        return false;
    }

    public boolean isSignedIn(@NonNull Context context) {
        return false;
    }

    public boolean hasAgentKey() {
        Context context = requireContext();
        return context != null && hasAgentKey(context);
    }

    public boolean hasAgentKey(@NonNull Context context) {
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
            callback.onResult(false, "Enter an Agent API key");
            return;
        }

        prefs(context).edit()
                .putString(KEY_API_KEY, trimmed)
                .putString(KEY_EMAIL, "")
                .putString(KEY_NAME, "Agent key")
                .apply();
        mainHandler.post(() -> callback.onResult(true, null));
    }

    /**
     * Returns the saved Agent API key for Authorization: Bearer <token>.
     * Returns "" when no Agent key is saved.
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
