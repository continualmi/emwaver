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
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.IBinder;
import android.util.Log;

import java.util.HashMap;

/**
 * Manages device connections for both BLE and USB.
 * Provides a unified interface for fragments to interact with devices
 * regardless of connection type.
 */
public class DeviceConnectionManager {
    private static final String TAG = "DeviceConnectionManager";
    private static DeviceConnectionManager instance;
    
    private Context context;
    private BLEService bleService;
    private USBService usbService;
    private boolean isBleServiceBound = false;
    private boolean isUsbServiceBound = false;
    
    private DeviceConnectionService activeService = null;
    private DeviceConnectionService.ConnectionType activeConnectionType = DeviceConnectionService.ConnectionType.NONE;
    
    // Service connections
    private final ServiceConnection bleServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isBleServiceBound = true;
            Log.d(TAG, "BLE Service Connected");
            checkAndUpdateActiveService();
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isBleServiceBound = false;
            bleService = null;
            Log.d(TAG, "BLE Service Disconnected");
            checkAndUpdateActiveService();
        }
    };
    
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
    
    /**
     * Initialize and bind to both services
     */
    public void initialize() {
        Log.d(TAG, "Initializing DeviceConnectionManager");
        
        // Start and bind BLE service
        Intent bleIntent = new Intent(context, BLEService.class);
        context.startService(bleIntent);
        context.bindService(bleIntent, bleServiceConnection, Context.BIND_AUTO_CREATE);
        
        // Start and bind USB service
        Intent usbIntent = new Intent(context, USBService.class);
        context.startService(usbIntent);
        context.bindService(usbIntent, usbServiceConnection, Context.BIND_AUTO_CREATE);
        
        // Check for USB devices immediately
        checkForUsbDevices();
    }
    
    /**
     * Check for connected USB devices and attempt connection
     */
    public void checkForUsbDevices() {
        if (usbService != null) {
            usbService.checkForConnectedDevices();
            checkAndUpdateActiveService();
        }
    }
    
    /**
     * Determine which service should be active based on connection status
     * Priority: USB > BLE
     */
    private void checkAndUpdateActiveService() {
        DeviceConnectionService newActiveService = null;
        DeviceConnectionService.ConnectionType newConnectionType = DeviceConnectionService.ConnectionType.NONE;
        
        // Check USB first (higher priority)
        if (usbService != null && usbService.checkConnection()) {
            newActiveService = usbService;
            newConnectionType = DeviceConnectionService.ConnectionType.USB;
        }
        // Fall back to BLE if USB not available
        else if (bleService != null && bleService.checkConnection()) {
            newActiveService = bleService;
            newConnectionType = DeviceConnectionService.ConnectionType.BLE;
        }
        
        // Update active service if changed
        if (newActiveService != activeService) {
            activeService = newActiveService;
            activeConnectionType = newConnectionType;
            Log.d(TAG, "Active service changed to: " + activeConnectionType);
        }
    }
    
    /**
     * Get the currently active connection service
     * @return Active DeviceConnectionService or null if none connected
     */
    public DeviceConnectionService getActiveService() {
        checkAndUpdateActiveService();
        return activeService;
    }
    
    /**
     * Get the current active connection type
     * @return ConnectionType enum value
     */
    public DeviceConnectionService.ConnectionType getActiveConnectionType() {
        checkAndUpdateActiveService();
        return activeConnectionType;
    }
    
    /**
     * Get BLE service (for BLE-specific operations like scanning)
     */
    public BLEService getBleService() {
        return bleService;
    }
    
    /**
     * Get USB service (for USB-specific operations)
     */
    public USBService getUsbService() {
        return usbService;
    }
    
    /**
     * Check if any device is connected
     */
    public boolean isConnected() {
        DeviceConnectionService service = getActiveService();
        return service != null && service.checkConnection();
    }
    
    /**
     * Start BLE scanning
     */
    public void startBleScan() {
        if (bleService != null) {
            bleService.startScan();
        }
    }
    
    /**
     * Disconnect from active service
     */
    public void disconnect() {
        if (activeService != null) {
            activeService.disconnect();
            activeService = null;
            activeConnectionType = DeviceConnectionService.ConnectionType.NONE;
        }
    }
    
    /**
     * Cleanup and unbind services
     */
    public void cleanup() {
        if (isBleServiceBound && context != null) {
            context.unbindService(bleServiceConnection);
            isBleServiceBound = false;
        }
        if (isUsbServiceBound && context != null) {
            context.unbindService(usbServiceConnection);
            isUsbServiceBound = false;
        }
        bleService = null;
        usbService = null;
        activeService = null;
        activeConnectionType = DeviceConnectionService.ConnectionType.NONE;
    }
    
    /**
     * Get connection status string for UI display
     */
    public String getConnectionStatus() {
        DeviceConnectionService service = getActiveService();
        if (service != null) {
            return service.getConnectionStatus();
        }
        return "Not connected";
    }
}
