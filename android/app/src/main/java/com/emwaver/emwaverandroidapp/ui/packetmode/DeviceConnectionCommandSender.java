package com.emwaver.emwaverandroidapp.ui.packetmode;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.CommandSender;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;

/**
 * CommandSender adapter that routes requests through DeviceConnectionManager so Packet Mode works
 * over either BLE or USB.
 */
public final class DeviceConnectionCommandSender implements CommandSender {
    private final DeviceConnectionManager connectionManager;

    public DeviceConnectionCommandSender(DeviceConnectionManager connectionManager) {
        this.connectionManager = connectionManager;
    }

    @Override
    @Nullable
    public byte[] sendCommandAndGetResponse(byte[] command, int expectedResponseSize, int busyDelay, long timeoutMillis) {
        if (connectionManager == null) {
            return null;
        }
        DeviceConnectionService service = connectionManager.getActiveService();
        if (service == null || !service.checkConnection()) {
            return null;
        }
        return service.sendCommand(command, (int) timeoutMillis);
    }
}

