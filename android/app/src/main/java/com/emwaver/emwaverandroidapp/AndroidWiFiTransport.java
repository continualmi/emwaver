/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import androidx.annotation.Nullable;

final class AndroidWiFiTransport {
    static final String TRANSPORT_NAME = "Wi-Fi";

    private AndroidWiFiTransport() {}

    static String sessionId(@Nullable String hostOrDeviceId) {
        String key = hostOrDeviceId == null || hostOrDeviceId.trim().isEmpty()
                ? "active"
                : hostOrDeviceId.trim();
        return "wifi:" + key;
    }

    static String displayName(@Nullable String hostOrDeviceId) {
        String key = hostOrDeviceId == null || hostOrDeviceId.trim().isEmpty()
                ? "device"
                : hostOrDeviceId.trim();
        return TRANSPORT_NAME + ": " + key;
    }
}
