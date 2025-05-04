package com.emwaver.emwaverandroidapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * BroadcastReceiver for handling BLE connection status changes.
 * This can be used to update UI components across the app when BLE status changes.
 */
public class BLEReceiver extends BroadcastReceiver {
    
    private static final String TAG = "BLEReceiver";
    
    // Broadcast action for BLE connection status change
    public static final String ACTION_BLE_CONNECTION_STATUS = 
            "com.emwaver.emwaverandroidapp.ACTION_BLE_CONNECTION_STATUS";
    
    // Extra for connection status
    public static final String EXTRA_CONNECTION_STATUS = "connection_status";
    
    // Listener interface for connection status changes
    public interface ConnectionStatusListener {
        void onConnectionStatusChanged(boolean connected);
    }
    
    private final ConnectionStatusListener listener;
    
    public BLEReceiver(ConnectionStatusListener listener) {
        this.listener = listener;
    }
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_BLE_CONNECTION_STATUS.equals(intent.getAction())) {
            boolean connected = intent.getBooleanExtra(EXTRA_CONNECTION_STATUS, false);
            Log.d(TAG, "Received BLE connection status broadcast: " + (connected ? "connected" : "disconnected"));
            
            if (listener != null) {
                listener.onConnectionStatusChanged(connected);
            }
        }
    }
} 