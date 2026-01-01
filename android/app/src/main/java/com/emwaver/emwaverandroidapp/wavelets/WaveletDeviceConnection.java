/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.wavelets;

import android.content.Context;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;

import java.nio.charset.StandardCharsets;

/**
 * Wavelet JS bridge for device I/O that routes through DeviceConnectionManager.
 * Exposed to Rhino as a global object (e.g. `DeviceConnection`).
 */
public final class WaveletDeviceConnection {
    private final DeviceConnectionManager connectionManager;

    public WaveletDeviceConnection(Context context) {
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

    @Nullable
    public byte[] sendCommandString(String command, int timeoutMs) {
        String framed = command != null ? command : "";
        if (!framed.endsWith("\n")) {
            framed += "\n";
        }
        return sendCommand(framed.getBytes(StandardCharsets.UTF_8), timeoutMs);
    }

    @Nullable
    public byte[] sendCommandString(String command) {
        return sendCommandString(command, 2000);
    }

    public void write(byte[] bytes) {
        DeviceConnectionService service = activeService();
        if (service == null) {
            return;
        }
        service.write(bytes);
    }

    public void disconnect() {
        if (connectionManager != null) {
            connectionManager.disconnect();
        }
    }
}

