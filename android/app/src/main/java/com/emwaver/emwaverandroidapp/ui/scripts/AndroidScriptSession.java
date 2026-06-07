/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

final class AndroidScriptSession {
    final String instanceId;
    private final Runnable stopAction;
    final String deviceId;
    final String scriptId;
    final String scriptName;
    final String deviceLabel;
    private boolean running = true;

    AndroidScriptSession(
            @NonNull String instanceId,
            @NonNull Runnable stopAction,
            @NonNull String deviceId,
            @Nullable String scriptId,
            @NonNull String scriptName,
            @NonNull String deviceLabel
    ) {
        this.instanceId = instanceId;
        this.stopAction = stopAction;
        this.deviceId = deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        this.scriptId = scriptId == null ? "" : scriptId;
        this.scriptName = scriptName;
        this.deviceLabel = deviceLabel;
    }

    String fileName() {
        String lower = scriptName.toLowerCase(java.util.Locale.US);
        return lower.endsWith(".emw") || lower.endsWith(".js")
                ? scriptName
                : scriptName + ".emw";
    }

    String statusLabel() {
        return (running ? "Running on " : "Stopped on ") + deviceLabel;
    }

    boolean isRunning() {
        return running;
    }

    void stop() {
        stopRuntime();
    }

    void stopRuntime() {
        if (!running) {
            return;
        }
        stopAction.run();
        running = false;
    }
}
