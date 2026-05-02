/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
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

    public ScriptDeviceConnection(Context context) {
        this.connectionManager = DeviceConnectionManager.getInstance(context);
    }

    @Nullable
    private DeviceConnectionService activeService() {
        return connectionManager != null ? connectionManager.getActiveService() : null;
    }

    public boolean isConnected() {
        return connectionManager != null && connectionManager.isConnected();
    }

    public String connectionStatus() {
        return connectionManager != null ? connectionManager.getConnectionStatus() : "Not connected";
    }

    public String connectionType() {
        if (connectionManager == null) {
            return DeviceConnectionService.ConnectionType.NONE.name();
        }
        return connectionManager.getActiveConnectionType().name();
    }

    @Nullable
    public byte[] sendCommand(byte[] command, int timeoutMs) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return null;
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
        service.write(bytes);
    }

    @Override
    public void transmitBuffer() {
        DeviceConnectionService service = activeService();
        if (service == null) {
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
        service.clearBuffer();
    }

    @Override
    public int getBufferLength() {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return 0;
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
        return service.getBuffer();
    }

    @Override
    public void loadBuffer(byte[] data) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        service.loadBuffer(data);
    }

    public void disconnect() {
        if (connectionManager != null) {
            connectionManager.disconnect();
        }
    }
}
