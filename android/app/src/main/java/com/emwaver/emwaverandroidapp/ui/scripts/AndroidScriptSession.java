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
    final String deviceId;
    final String scriptId;
    final String scriptName;
    final String deviceLabel;

    AndroidScriptSession(
            @NonNull String instanceId,
            @NonNull String deviceId,
            @Nullable String scriptId,
            @NonNull String scriptName,
            @NonNull String deviceLabel
    ) {
        this.instanceId = instanceId;
        this.deviceId = deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        this.scriptId = scriptId == null ? "" : scriptId;
        this.scriptName = scriptName;
        this.deviceLabel = deviceLabel;
    }

    String fileName() {
        return scriptName.toLowerCase(java.util.Locale.US).endsWith(".emw")
                ? scriptName
                : scriptName + ".emw";
    }

    String statusLabel() {
        return "Running on " + deviceLabel;
    }
}
