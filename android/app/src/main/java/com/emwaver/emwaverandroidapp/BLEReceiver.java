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