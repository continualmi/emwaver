/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

public final class AgentApiKeyStore {
    private static final String PREFS = "emwaver.agent";
    private static final String KEY_API_KEY = "api_key";

    public interface SaveCallback {
        void onResult(boolean success, @Nullable String errorMessage);
    }

    private static volatile AgentApiKeyStore instance;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    @Nullable private Context appContext;

    private AgentApiKeyStore() {}

    public static AgentApiKeyStore getInstance() {
        if (instance == null) {
            synchronized (AgentApiKeyStore.class) {
                if (instance == null) {
                    instance = new AgentApiKeyStore();
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

    public boolean hasAgentKey() {
        Context context = requireContext();
        return context != null && hasAgentKey(context);
    }

    public boolean hasAgentKey(@NonNull Context context) {
        return !getAgentApiKey(context).trim().isEmpty();
    }

    public void saveApiKeyAsync(@NonNull Context context, @Nullable String apiKey, @NonNull SaveCallback callback) {
        final String trimmed = apiKey == null ? "" : apiKey.trim();
        if (trimmed.isEmpty()) {
            callback.onResult(false, "Enter an Agent API key");
            return;
        }

        prefs(context).edit().putString(KEY_API_KEY, trimmed).apply();
        mainHandler.post(() -> callback.onResult(true, null));
    }

    @NonNull
    public String getAgentApiKey(@NonNull Context context) {
        return prefs(context).getString(KEY_API_KEY, "");
    }

    @NonNull
    public String getAgentApiKey() {
        Context context = requireContext();
        return context != null ? getAgentApiKey(context) : "";
    }

    public void clear(@NonNull Context context) {
        prefs(context).edit().clear().apply();
    }

    public void clear() {
        Context context = requireContext();
        if (context != null) {
            clear(context);
        }
    }
}
