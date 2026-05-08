/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

final class TransportDeviceSessionRegistry {
    private final Map<String, TransportDeviceSession> sessionsByDeviceId = new HashMap<>();
    private TransportDeviceSession activeSession = new DeviceBufferSession();

    synchronized TransportDeviceSession active() {
        return activeSession;
    }

    synchronized TransportDeviceSession session(String deviceId) {
        String key = normalize(deviceId);
        TransportDeviceSession session = sessionsByDeviceId.get(key.toLowerCase(Locale.US));
        if (session == null) {
            session = new DeviceBufferSession(key);
            sessionsByDeviceId.put(key.toLowerCase(Locale.US), session);
        }
        return session;
    }

    synchronized TransportDeviceSession select(String deviceId, boolean resetSession) {
        TransportDeviceSession session = session(deviceId);
        activeSession = session;
        if (resetSession) {
            session.clearAll();
        }
        return session;
    }

    private static String normalize(String deviceId) {
        return deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
    }
}
