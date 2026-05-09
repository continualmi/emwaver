/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import androidx.annotation.Nullable;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class TransportDeviceConnectionState<T> {
    private final T noneTransport;
    private final Map<String, TransportDeviceConnection> connectionsByDeviceId = new HashMap<>();
    private ActiveDeviceTarget<T> target;
    private TransportDeviceConnection connection;

    TransportDeviceConnectionState(T noneTransport) {
        this.noneTransport = noneTransport;
        this.target = new ActiveDeviceTarget<>("active", noneTransport);
    }

    ActiveDeviceTarget<T> setTarget(String deviceId, T transport) {
        target = new ActiveDeviceTarget<>(deviceId, transport);
        connection = null;
        return target;
    }

    void setConnection(@Nullable TransportDeviceConnection connection) {
        this.connection = connection;
        if (connection != null) {
            connectionsByDeviceId.put(normalize(connection.sessionId()), connection);
        }
    }

    void clear() {
        target = new ActiveDeviceTarget<>("active", noneTransport);
        connection = null;
        connectionsByDeviceId.clear();
    }

    void clear(T transport) {
        if (matchesTransport(transport)) {
            clear();
        }
    }

    String currentScriptDeviceId() {
        return connection != null ? connection.sessionId() : target.deviceId;
    }

    boolean matchesDeviceId(String deviceId) {
        return target.matchesDeviceId(deviceId);
    }

    boolean matchesTransport(T transport) {
        return target.matchesTransport(transport);
    }

    T transport() {
        return target.transport;
    }

    @Nullable
    TransportDeviceConnection connection() {
        return connection;
    }

    @Nullable
    TransportDeviceConnection connection(String deviceId) {
        return connectionsByDeviceId.get(normalize(deviceId));
    }

    private static String normalize(String deviceId) {
        String key = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        return key.toLowerCase(Locale.US);
    }
}
