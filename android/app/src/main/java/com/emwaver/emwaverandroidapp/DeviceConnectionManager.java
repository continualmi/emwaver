/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

/**
 * Current Android connection manager implementation (USB MIDI today).
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

            // Important: when the app is launched via USB_DEVICE_ATTACHED intent, initialize()
            // can run before the service is actually bound. Re-scan here to avoid requiring a
            // physical unplug/replug.
            try {
                usbService.checkForConnectedDevices();
            } catch (Throwable ignored) {
            }

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
        Log.d(TAG, "Initializing DeviceConnectionManager (USB MIDI)");

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
