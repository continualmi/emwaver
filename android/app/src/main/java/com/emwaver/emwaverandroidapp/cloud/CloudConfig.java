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
 *  1) env EMWAVER_BACKEND_URL
 *  2) SharedPreferences (emwaver.cloud.backend_url)
 *  3) default: http://10.0.2.2:8787 (Android emulator -> host localhost)
 */
public final class CloudConfig {
    private static final String PREFS = "emwaver";
    private static final String KEY_BACKEND_URL = "emwaver.cloud.backend_url";

    private CloudConfig() {}

    public static String getBackendBaseUrl(Context context) {
        String env = System.getenv("EMWAVER_BACKEND_URL");
        if (env != null && !env.trim().isEmpty()) {
            return env.trim();
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String v = prefs.getString(KEY_BACKEND_URL, "");
        if (v != null && !v.trim().isEmpty()) {
            return v.trim();
        }

        return "http://10.0.2.2:8787";
    }

    public static void setBackendBaseUrl(Context context, String url) {
        if (url == null) url = "";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BACKEND_URL, url.trim())
                .apply();
    }

    public static boolean allowAnonSync() {
        String env = System.getenv("EMWAVER_ALLOW_ANON_SYNC");
        return env != null && env.trim().equals("1");
    }
}
