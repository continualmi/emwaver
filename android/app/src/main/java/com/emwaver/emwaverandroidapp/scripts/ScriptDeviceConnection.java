/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import android.content.Context;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;


/**
 * Script JS bridge for device I/O that routes through DeviceConnectionManager.
 * Exposed to Rhino as a global object (e.g. `DeviceConnection`).
 */
public final class ScriptDeviceConnection implements ScriptDeviceBridge {
    private final DeviceConnectionManager connectionManager;
    private final DeviceConnectionService targetService;
    private final DeviceConnectionService.ConnectionType targetConnectionType;
    private final String targetLabel;
    private final String targetDeviceId;

    public ScriptDeviceConnection(Context context) {
        this.connectionManager = DeviceConnectionManager.getInstance(context);
        this.targetService = null;
        this.targetConnectionType = DeviceConnectionService.ConnectionType.NONE;
        this.targetLabel = null;
        this.targetDeviceId = null;
    }

    private ScriptDeviceConnection(Context context, DeviceConnectionService targetService, String targetLabel) {
        this.connectionManager = DeviceConnectionManager.getInstance(context);
        this.targetService = targetService;
        this.targetConnectionType = targetService != null ? targetService.getConnectionType() : DeviceConnectionService.ConnectionType.NONE;
        this.targetLabel = targetLabel;
        this.targetDeviceId = targetService != null ? normalizeDeviceId(targetService.currentScriptDeviceId()) : null;
    }

    ScriptDeviceConnection(DeviceConnectionService targetService, String targetLabel) {
        this.connectionManager = null;
        this.targetService = targetService;
        this.targetConnectionType = targetService != null ? targetService.getConnectionType() : DeviceConnectionService.ConnectionType.NONE;
        this.targetLabel = targetLabel;
        this.targetDeviceId = targetService != null ? normalizeDeviceId(targetService.currentScriptDeviceId()) : null;
    }

    public static ScriptDeviceConnection captureActive(Context context, String targetLabel) {
        DeviceConnectionManager manager = DeviceConnectionManager.getInstance(context);
        DeviceConnectionService service = manager != null ? manager.getActiveService() : null;
        return new ScriptDeviceConnection(context, service, targetLabel);
    }

    @Nullable
    private DeviceConnectionService activeService() {
        if (targetService != null) {
            return targetService;
        }
        return connectionManager != null ? connectionManager.getActiveService() : null;
    }

    public boolean isConnected() {
        DeviceConnectionService service = activeService();
        return service != null && service.checkConnection();
    }

    public String connectionStatus() {
        if (targetService != null) {
            return targetLabel != null && !targetLabel.trim().isEmpty() ? targetLabel : targetService.getConnectionStatus();
        }
        return connectionManager != null ? connectionManager.getConnectionStatus() : "Not connected";
    }

    public String connectionType() {
        if (targetService != null) {
            return targetConnectionType.name();
        }
        if (connectionManager == null) {
            return DeviceConnectionService.ConnectionType.NONE.name();
        }
        return connectionManager.getActiveConnectionType().name();
    }

    public String capturedDeviceId() {
        return targetDeviceId != null ? targetDeviceId : "active";
    }

    private static String normalizeDeviceId(String deviceId) {
        if (deviceId == null) {
            return "active";
        }
        String trimmed = deviceId.trim();
        return trimmed.isEmpty() ? "active" : trimmed;
    }

    @Nullable
    public byte[] sendCommand(byte[] command, int timeoutMs) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return null;
        }
        if (targetService != null && targetDeviceId != null) {
            return service.sendCommand(command, timeoutMs, targetDeviceId);
        }
        return service.sendCommand(command, timeoutMs);
    }

    /** Sends a raw command packet and waits for the response. */
    @Nullable
    @Override
    public byte[] sendPacket(byte[] data, int timeoutMs) {
        return sendCommand(data, timeoutMs);
    }

    @Nullable
    public byte[] sendPacket(byte[] data) {
        return sendPacket(data, 2000);
    }

    public void write(byte[] bytes) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        if (targetService != null && targetDeviceId != null) {
            service.write(bytes, targetDeviceId);
            return;
        }
        service.write(bytes);
    }

    @Override
    public void transmitBuffer() {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        if (targetService != null && targetDeviceId != null) {
            service.transmitBuffer(targetDeviceId);
            return;
        }
        service.transmitBuffer();
    }

    @Override
    public void clearBuffer() {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        if (targetService != null && targetDeviceId != null) {
            service.clearBuffer(targetDeviceId);
            return;
        }
        service.clearBuffer();
    }

    @Override
    public int getBufferLength() {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return 0;
        }
        if (targetService != null && targetDeviceId != null) {
            return Math.max(0, service.getBufferLength(targetDeviceId));
        }
        return Math.max(0, service.getBufferLength());
    }

    @Nullable
    @Override
    public byte[] getBuffer() {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return null;
        }
        if (targetService != null && targetDeviceId != null) {
            return service.getBuffer(targetDeviceId);
        }
        return service.getBuffer();
    }

    @Override
    public void loadBuffer(byte[] data) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        if (targetService != null && targetDeviceId != null) {
            service.loadBuffer(data, targetDeviceId);
            return;
        }
        service.loadBuffer(data);
    }

    public void disconnect() {
        if (targetService != null) {
            targetService.disconnect();
            return;
        }
        if (connectionManager != null) {
            connectionManager.disconnect();
        }
    }
}
