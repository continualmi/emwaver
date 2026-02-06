/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONException;
import org.json.JSONObject;

public final class HostSession {
    @NonNull public final String id;
    @NonNull public final String platform;
    @NonNull public final String deviceName;
    @NonNull public final String appVersion;
    public final boolean online;

    // Known status fields (best-effort)
    public final boolean usbConnected;
    @NonNull public final String connectedPort;
    public final boolean scriptRunning;
    @NonNull public final String activeScriptName;

    public HostSession(
            @NonNull String id,
            @NonNull String platform,
            @NonNull String deviceName,
            @NonNull String appVersion,
            boolean online,
            boolean usbConnected,
            @NonNull String connectedPort,
            boolean scriptRunning,
            @NonNull String activeScriptName
    ) {
        this.id = id;
        this.platform = platform;
        this.deviceName = deviceName;
        this.appVersion = appVersion;
        this.online = online;
        this.usbConnected = usbConnected;
        this.connectedPort = connectedPort;
        this.scriptRunning = scriptRunning;
        this.activeScriptName = activeScriptName;
    }

    @NonNull
    static HostSession fromJson(@NonNull JSONObject o) throws JSONException {
        String id = o.optString("id", "");
        String platform = o.optString("platform", "unknown");
        String deviceName = o.optString("device_name", "");
        String appVersion = o.optString("app_version", "");
        boolean online = o.optBoolean("online", false);

        boolean usbConnected = false;
        String connectedPort = "";
        boolean scriptRunning = false;
        String activeScriptName = "";

        JSONObject status = o.optJSONObject("status");
        if (status != null) {
            usbConnected = status.optBoolean("usb_connected", false);
            connectedPort = status.optString("connected_port", "");
            scriptRunning = status.optBoolean("script_running", false);
            activeScriptName = status.optString("active_script_name", "");
        }

        if (id == null) id = "";
        if (platform == null) platform = "unknown";
        if (deviceName == null) deviceName = "";
        if (appVersion == null) appVersion = "";
        if (connectedPort == null) connectedPort = "";
        if (activeScriptName == null) activeScriptName = "";

        if (id.trim().isEmpty()) {
            // Backend guarantees id, but be defensive.
            id = "<unknown>";
        }

        return new HostSession(
                id,
                platform,
                deviceName,
                appVersion,
                online,
                usbConnected,
                connectedPort,
                scriptRunning,
                activeScriptName
        );
    }

    @NonNull
    public String title() {
        if (deviceName != null && !deviceName.trim().isEmpty()) return deviceName.trim();
        return id;
    }

    @NonNull
    public String subtitle() {
        String p = platform != null && !platform.trim().isEmpty() ? platform.trim() : "unknown";
        if (appVersion != null && !appVersion.trim().isEmpty()) {
            return p + " · v" + appVersion.trim();
        }
        return p;
    }
}
