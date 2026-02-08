/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;

/**
 * Backend config.
 *
 * Product direction: Android talks to the fixed production backend.
 * (No user-configurable backend URL in Settings.)
 */
public final class CloudConfig {
    private static final String DEFAULT_BACKEND_URL = "https://emwaver-backend.delightfuldune-64bd11df.westeurope.azurecontainerapps.io";

    private CloudConfig() {}

    public static String getBackendBaseUrl(Context context) {
        return DEFAULT_BACKEND_URL;
    }

    public static boolean allowAnonSync() {
        // Android sign-in isn't wired yet; anon sync is the default dev behavior.
        // Keeping this as an always-on toggle avoids requiring env flags on-device.
        return true;
    }
}
