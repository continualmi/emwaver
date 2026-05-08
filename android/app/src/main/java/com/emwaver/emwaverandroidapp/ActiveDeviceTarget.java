/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import java.util.Locale;

final class ActiveDeviceTarget<T> {
    final String deviceId;
    final T transport;

    ActiveDeviceTarget(String deviceId, T transport) {
        String key = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        this.deviceId = key;
        this.transport = transport;
    }

    boolean matchesDeviceId(String deviceId) {
        String requested = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        return this.deviceId.toLowerCase(Locale.US).equals(requested.toLowerCase(Locale.US));
    }

    boolean matchesTransport(T transport) {
        return this.transport == transport || (this.transport != null && this.transport.equals(transport));
    }
}
