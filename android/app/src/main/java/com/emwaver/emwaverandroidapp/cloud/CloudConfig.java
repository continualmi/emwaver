/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Minimal config for backend sync.
 *
 * Priority:
 *  1) env EMWAVER_BACKEND_URL (optional)
 *  2) if emwaver.cloud.use_local_backend=true and emwaver.cloud.local_backend_url is set
 *  3) SharedPreferences legacy override (emwaver.cloud.backend_url) (optional)
 *  4) default production backend URL
 */
public final class CloudConfig {
    private static final String PREFS = "emwaver";

    // Legacy single override (kept for backwards compatibility / dev overrides).
    private static final String KEY_BACKEND_URL = "emwaver.cloud.backend_url";

    // New: production vs local selection.
    private static final String KEY_USE_LOCAL_BACKEND = "emwaver.cloud.use_local_backend";
    private static final String KEY_LOCAL_BACKEND_URL = "emwaver.cloud.local_backend_url";

    private static final String DEFAULT_BACKEND_URL = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";

    private CloudConfig() {}

    public static String getBackendBaseUrl(Context context) {
        // Highest priority: env override (useful for emulators / CI).
        String env = System.getenv("EMWAVER_BACKEND_URL");
        if (env != null && !env.trim().isEmpty()) {
            return normalizeBaseUrl(env);
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        // Preferred: explicit local toggle + local URL.
        boolean useLocal = prefs.getBoolean(KEY_USE_LOCAL_BACKEND, false);
        if (useLocal) {
            String local = prefs.getString(KEY_LOCAL_BACKEND_URL, "");
            if (local != null && !local.trim().isEmpty()) {
                return normalizeBaseUrl(local);
            }
        }

        // Backwards compatibility: a single overridden base URL.
        String v = prefs.getString(KEY_BACKEND_URL, "");
        if (v != null && !v.trim().isEmpty()) {
            return normalizeBaseUrl(v);
        }

        return DEFAULT_BACKEND_URL;
    }

    /**
     * Legacy setter for a single backend base URL override.
     * Prefer using setUseLocalBackend + setLocalBackendUrl for new UI.
     */
    public static void setBackendBaseUrl(Context context, String url) {
        if (url == null) url = "";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BACKEND_URL, url.trim())
                .apply();
    }

    public static boolean getUseLocalBackend(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_USE_LOCAL_BACKEND, false);
    }

    public static void setUseLocalBackend(Context context, boolean useLocal) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_USE_LOCAL_BACKEND, useLocal)
                .apply();
    }

    public static String getLocalBackendUrl(Context context) {
        String v = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_LOCAL_BACKEND_URL, "");
        return v == null ? "" : v;
    }

    public static void setLocalBackendUrl(Context context, String url) {
        if (url == null) url = "";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LOCAL_BACKEND_URL, url.trim())
                .apply();
    }

    private static String normalizeBaseUrl(String url) {
        String v = url == null ? "" : url.trim();
        while (v.endsWith("/")) {
            v = v.substring(0, v.length() - 1);
        }
        return v;
    }

    public static boolean allowAnonSync() {
        // Android sign-in isn't wired yet; anon sync is the default dev behavior.
        // Keeping this as an always-on toggle avoids requiring env flags on-device.
        return true;
    }
}
