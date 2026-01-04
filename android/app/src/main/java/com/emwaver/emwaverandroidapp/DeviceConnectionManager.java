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

package com.emwaver.emwaverandroidapp;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

/**
 * USB-only connection manager (USB MIDI).
 */
public class DeviceConnectionManager {
    private static final String TAG = "DeviceConnectionManager";
    private static DeviceConnectionManager instance;

    private final Context context;

    private USBService usbService;
    private boolean isUsbServiceBound = false;

    private DeviceConnectionService activeService = null;
    private DeviceConnectionService.ConnectionType activeConnectionType = DeviceConnectionService.ConnectionType.NONE;

    private final ServiceConnection usbServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            USBService.LocalBinder binder = (USBService.LocalBinder) service;
            usbService = binder.getService();
            isUsbServiceBound = true;
            Log.d(TAG, "USB Service Connected");
            checkAndUpdateActiveService();
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isUsbServiceBound = false;
            usbService = null;
            Log.d(TAG, "USB Service Disconnected");
            checkAndUpdateActiveService();
        }
    };

    private DeviceConnectionManager(Context context) {
        this.context = context.getApplicationContext();
    }

    public static synchronized DeviceConnectionManager getInstance(Context context) {
        if (instance == null) {
            instance = new DeviceConnectionManager(context);
        }
        return instance;
    }

    /** Initialize and bind to USB service. */
    public void initialize() {
        Log.d(TAG, "Initializing DeviceConnectionManager (USB MIDI only)");

        Intent usbIntent = new Intent(context, USBService.class);
        context.startService(usbIntent);
        context.bindService(usbIntent, usbServiceConnection, Context.BIND_AUTO_CREATE);

        checkForUsbDevices();
    }

    public void checkForUsbDevices() {
        if (usbService != null) {
            usbService.checkForConnectedDevices();
            checkAndUpdateActiveService();
        }
    }

    private void checkAndUpdateActiveService() {
        DeviceConnectionService newActiveService = null;
        DeviceConnectionService.ConnectionType newConnectionType = DeviceConnectionService.ConnectionType.NONE;

        if (usbService != null && usbService.checkConnection()) {
            newActiveService = usbService;
            newConnectionType = DeviceConnectionService.ConnectionType.USB;
        }

        if (newActiveService != activeService) {
            activeService = newActiveService;
            activeConnectionType = newConnectionType;
            Log.d(TAG, "Active service changed to: " + activeConnectionType);
        }
    }

    public DeviceConnectionService getActiveService() {
        checkAndUpdateActiveService();
        return activeService;
    }

    public DeviceConnectionService.ConnectionType getActiveConnectionType() {
        checkAndUpdateActiveService();
        return activeConnectionType;
    }

    public USBService getUsbService() {
        return usbService;
    }

    public boolean isConnected() {
        DeviceConnectionService service = getActiveService();
        return service != null && service.checkConnection();
    }

    public void disconnect() {
        if (activeService != null) {
            activeService.disconnect();
            activeService = null;
            activeConnectionType = DeviceConnectionService.ConnectionType.NONE;
        }
    }

    public void cleanup() {
        if (isUsbServiceBound && context != null) {
            context.unbindService(usbServiceConnection);
            isUsbServiceBound = false;
        }
        usbService = null;
        activeService = null;
        activeConnectionType = DeviceConnectionService.ConnectionType.NONE;
    }

    public String getConnectionStatus() {
        DeviceConnectionService service = getActiveService();
        if (service != null) {
            return service.getConnectionStatus();
        }
        return "Not connected";
    }
}
