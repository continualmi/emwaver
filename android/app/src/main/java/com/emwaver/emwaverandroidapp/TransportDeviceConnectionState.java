/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import androidx.annotation.Nullable;

final class TransportDeviceConnectionState<T> {
    private final T noneTransport;
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
    }

    void clear() {
        target = new ActiveDeviceTarget<>("active", noneTransport);
        connection = null;
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
}
