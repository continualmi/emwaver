/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import com.emwaver.emwaverandroidapp.BuildConfig;

public final class AgentConfig {
    private AgentConfig() {}

    public static String getAgentEndpoint() {
        String endpoint = BuildConfig.EMWAVER_AGENT_ENDPOINT;
        if (endpoint == null || endpoint.trim().isEmpty()) {
            endpoint = BuildConfig.CONTINUAL_AGENT_ENDPOINT;
        }
        return endpoint != null ? endpoint.trim() : "";
    }
}
