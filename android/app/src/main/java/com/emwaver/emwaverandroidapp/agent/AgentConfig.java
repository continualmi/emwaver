/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import android.text.TextUtils;

import com.emwaver.emwaverandroidapp.BuildConfig;

public final class AgentConfig {
    private AgentConfig() {}

    private static final String DEFAULT_ENDPOINT = "https://mdl.continualmi.com/api/mgpt/responses";

    public static String getAgentEndpoint() {
        // Prefer explicit override env/hardcoded value if configured
        String explicit = BuildConfig.EMWAVER_AGENT_ENDPOINT;
        if (!TextUtils.isEmpty(explicit)) return explicit.trim();

        // Fallback to the canonical MDL platform MGPT endpoint (matches macOS)
        return DEFAULT_ENDPOINT;
    }
}
