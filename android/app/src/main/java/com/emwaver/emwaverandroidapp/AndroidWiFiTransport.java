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

    static final class Connection {
        final String hostOrDeviceId;
        final String sessionId;
        final String displayName;
        final TransportDeviceSession session;

        Connection(@Nullable String hostOrDeviceId) {
            this(hostOrDeviceId, null);
        }

        Connection(@Nullable String hostOrDeviceId, @Nullable TransportDeviceSession session) {
            String key = normalizeKey(hostOrDeviceId, "active");
            this.hostOrDeviceId = key;
            this.sessionId = AndroidWiFiTransport.sessionId(key);
            this.displayName = AndroidWiFiTransport.displayName(key);
            this.session = session != null ? session : new DeviceBufferSession(this.sessionId);
        }
    }

    static String sessionId(@Nullable String hostOrDeviceId) {
        String key = normalizeKey(hostOrDeviceId, "active");
        return "wifi:" + key;
    }

    static String displayName(@Nullable String hostOrDeviceId) {
        String key = normalizeKey(hostOrDeviceId, "device");
        return TRANSPORT_NAME + ": " + key;
    }

    private static String normalizeKey(@Nullable String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
