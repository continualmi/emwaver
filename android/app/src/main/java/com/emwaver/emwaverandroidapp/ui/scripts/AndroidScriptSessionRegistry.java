/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class AndroidScriptSessionRegistry {
    private final Map<String, AndroidScriptSession> sessionsById = new LinkedHashMap<>();
    private String selectedSessionId;

    AndroidScriptSession start(
            @NonNull Runnable stopAction,
            @Nullable String scriptId,
            @NonNull String scriptName,
            @NonNull String deviceLabel,
            @NonNull String deviceId
    ) {
        String instanceId = UUID.randomUUID().toString();
        AndroidScriptSession session = new AndroidScriptSession(instanceId, stopAction, deviceId, scriptId, scriptName, deviceLabel);
        sessionsById.put(instanceId, session);
        selectedSessionId = instanceId;
        return session;
    }

    void stop(@Nullable String instanceId) {
        if (instanceId == null) {
            return;
        }
        AndroidScriptSession removed = sessionsById.remove(instanceId);
        if (removed != null) {
            removed.stop();
        }
        if (instanceId.equals(selectedSessionId)) {
            selectedSessionId = sessionsById.isEmpty()
                    ? null
                    : new ArrayList<>(sessionsById.keySet()).get(sessionsById.size() - 1);
        }
    }

    void stopSelected() {
        stop(selectedSessionId);
    }

    void clear() {
        for (AndroidScriptSession session : sessionsById.values()) {
            session.stop();
        }
        sessionsById.clear();
        selectedSessionId = null;
    }

    boolean hasSessions() {
        return !sessionsById.isEmpty();
    }

    @Nullable
    AndroidScriptSession selectedSession() {
        return selectedSessionId == null ? null : sessionsById.get(selectedSessionId);
    }

    List<AndroidScriptSession> sessions() {
        return new ArrayList<>(sessionsById.values());
    }
}
