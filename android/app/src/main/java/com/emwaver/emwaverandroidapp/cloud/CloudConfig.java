/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.SharedPreferences;

import com.emwaver.emwaverandroidapp.BuildConfig;

/**
 * Backend/frontend config with staff-only cloud/local switching.
 */
public final class CloudConfig {
    private static final String PREFS = "emwaver";
    private static final String KEY_BACKEND_MODE = "staff.backend.mode";   // cloud | local
    private static final String KEY_FRONTEND_MODE = "staff.frontend.mode"; // cloud | local

    private CloudConfig() {}

    public static boolean isStaffOnlyEnabled() {
        return BuildConfig.EMWAVER_STAFF_ONLY;
    }

    public static boolean isHostedServicesUiEnabled() {
        return BuildConfig.EMWAVER_HOSTED_SERVICES_UI_ENABLED;
    }

    public static boolean isHostedRemoteControlEnabled() {
        return BuildConfig.EMWAVER_HOSTED_REMOTE_CONTROL_ENABLED;
    }

    private static String readMode(Context context, String key) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return p.getString(key, "cloud");
    }

    public static String getBackendBaseUrl(Context context) {
        String mode = readMode(context, KEY_BACKEND_MODE);
        if ("local".equalsIgnoreCase(mode)) return BuildConfig.EMWAVER_BACKEND_URL_LOCAL;
        return BuildConfig.EMWAVER_BACKEND_URL_CLOUD;
    }

    public static String getFrontendBaseUrl(Context context) {
        String mode = readMode(context, KEY_FRONTEND_MODE);
        if ("local".equalsIgnoreCase(mode)) return BuildConfig.EMWAVER_FRONTEND_URL_LOCAL;
        return BuildConfig.EMWAVER_FRONTEND_URL_CLOUD;
    }

    public static boolean allowAnonSync() {
        // Android sign-in isn't wired yet; anon sync is the default dev behavior.
        return true;
    }
}
