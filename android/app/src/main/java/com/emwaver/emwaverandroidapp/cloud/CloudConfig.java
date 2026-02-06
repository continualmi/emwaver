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
 *  2) SharedPreferences (emwaver.cloud.backend_url) (optional)
 *  3) default: https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io
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

        return "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";
    }

    public static void setBackendBaseUrl(Context context, String url) {
        if (url == null) url = "";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_BACKEND_URL, url.trim())
                .apply();
    }

    public static boolean allowAnonSync() {
        // Android sign-in isn't wired yet; anon sync is the default dev behavior.
        // Keeping this as an always-on toggle avoids requiring env flags on-device.
        return true;
    }
}
