package com.emwaver.emwaverandroidapp;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.ActivityCompat;

import com.emwaver.emwaverandroidapp.files.FileRepositoryLocal;
import com.emwaver.emwaverandroidapp.files.UserFileMetadata;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * BLE GATT Server for file sync with CLI
 * Android app acts as peripheral, CLI acts as central
 */
public class BLEFileSyncServer {
    private static final String TAG = "BLEFileSyncServer";
    
    // File Sync Service UUIDs (different from device control service)
    private static final UUID FILE_SYNC_SERVICE_UUID = 
        UUID.fromString("50c7158e-0c3b-4e90-a847-452a15b14190");
    private static final UUID FILE_SYNC_CHAR_UUID = 
        UUID.fromString("51c7158e-0c3b-4e90-a847-452a15b14191");
    private static final UUID CLIENT_CONFIG_DESCRIPTOR_UUID = 
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    
    private final Context context;
    private final FileRepositoryLocal fileRepo;
    private BluetoothManager bluetoothManager;
    private BluetoothGattServer gattServer;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattCharacteristic fileSyncChar;
    
    private boolean isAdvertising = false;
    private BluetoothDevice connectedDevice;
    
    public BLEFileSyncServer(Context context) {
        this.context = context.getApplicationContext();
        this.fileRepo = FileRepositoryLocal.getInstance(context);
        this.bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
    }
    
    public void start() {
        if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
            != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Missing BLUETOOTH_CONNECT permission");
            return;
        }
        
        BluetoothAdapter adapter = bluetoothManager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            Log.e(TAG, "Bluetooth is not enabled");
            return;
        }
        
        // Open GATT server
        gattServer = bluetoothManager.openGattServer(context, gattServerCallback);
        if (gattServer == null) {
            Log.e(TAG, "Failed to open GATT server");
            return;
        }
        
        // Create file sync service
        BluetoothGattService service = new BluetoothGattService(
            FILE_SYNC_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        );
        
        // Create file sync characteristic (read/write/notify)
        fileSyncChar = new BluetoothGattCharacteristic(
            FILE_SYNC_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ |
            BluetoothGattCharacteristic.PROPERTY_WRITE |
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ |
            BluetoothGattCharacteristic.PERMISSION_WRITE
        );
        
        // Add client config descriptor for notifications
        BluetoothGattDescriptor descriptor = new BluetoothGattDescriptor(
            CLIENT_CONFIG_DESCRIPTOR_UUID,
            BluetoothGattDescriptor.PERMISSION_READ |
            BluetoothGattDescriptor.PERMISSION_WRITE
        );
        fileSyncChar.addDescriptor(descriptor);
        
        service.addCharacteristic(fileSyncChar);
        gattServer.addService(service);
        
        // Start advertising
        startAdvertising();
        
        Log.i(TAG, "BLE File Sync Server started");
    }
    
    public void stop() {
        stopAdvertising();
        
        if (gattServer != null) {
            if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                == PackageManager.PERMISSION_GRANTED) {
                gattServer.close();
            }
            gattServer = null;
        }
        
        Log.i(TAG, "BLE File Sync Server stopped");
    }
    
    private void startAdvertising() {
        BluetoothAdapter adapter = bluetoothManager.getAdapter();
        if (adapter == null) return;
        
        if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) 
            != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Missing BLUETOOTH_ADVERTISE permission");
            return;
        }
        
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            Log.e(TAG, "BLE advertising not supported");
            return;
        }
        
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build();
        
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)  // Don't include name to save space
            .addServiceUuid(new ParcelUuid(FILE_SYNC_SERVICE_UUID))
            .build();
        
        advertiser.startAdvertising(settings, data, advertiseCallback);
    }
    
    private void stopAdvertising() {
        if (advertiser != null && isAdvertising) {
            if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) 
                == PackageManager.PERMISSION_GRANTED) {
                advertiser.stopAdvertising(advertiseCallback);
            }
            isAdvertising = false;
        }
    }
    
    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            isAdvertising = true;
            Log.i(TAG, "Advertising started - EMWaver phone is discoverable");
        }
        
        @Override
        public void onStartFailure(int errorCode) {
            isAdvertising = false;
            Log.e(TAG, "Advertising failed: " + errorCode);
        }
    };
    
    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                connectedDevice = device;
                Log.i(TAG, "CLI connected: " + device.getAddress());
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                connectedDevice = null;
                Log.i(TAG, "CLI disconnected");
            }
        }
        
        @Override
        public void onCharacteristicReadRequest(BluetoothDevice device, int requestId, int offset,
                                                BluetoothGattCharacteristic characteristic) {
            if (FILE_SYNC_CHAR_UUID.equals(characteristic.getUuid())) {
                if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                    == PackageManager.PERMISSION_GRANTED) {
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, new byte[0]);
                }
            }
        }
        
        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                                                 BluetoothGattCharacteristic characteristic,
                                                 boolean preparedWrite, boolean responseNeeded,
                                                 int offset, byte[] value) {
            if (FILE_SYNC_CHAR_UUID.equals(characteristic.getUuid())) {
                // Handle file sync request
                handleFileSyncRequest(device, value);
                
                if (responseNeeded) {
                    if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                        == PackageManager.PERMISSION_GRANTED) {
                        gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
                    }
                }
            }
        }
        
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                                            BluetoothGattDescriptor descriptor,
                                            boolean preparedWrite, boolean responseNeeded,
                                            int offset, byte[] value) {
            if (CLIENT_CONFIG_DESCRIPTOR_UUID.equals(descriptor.getUuid())) {
                // Client is enabling/disabling notifications
                if (responseNeeded) {
                    if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                        == PackageManager.PERMISSION_GRANTED) {
                        gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null);
                    }
                }
                Log.d(TAG, "Notifications enabled");
            }
        }
    };
    
    private void handleFileSyncRequest(BluetoothDevice device, byte[] data) {
        try {
            String json = new String(data, StandardCharsets.UTF_8);
            JSONObject request = new JSONObject(json);
            String op = request.getString("op");
            
            Log.d(TAG, "Received file sync request: " + op);
            
            switch (op) {
                case "list":
                    handleListRequest(device);
                    break;
                case "push":
                    handlePushRequest(device, request);
                    break;
                case "pull":
                    handlePullRequest(device, request);
                    break;
                case "remove":
                    handleRemoveRequest(device, request);
                    break;
                default:
                    sendError(device, "Unknown operation: " + op);
            }
        } catch (JSONException e) {
            Log.e(TAG, "Failed to parse file sync request", e);
            sendError(device, "Invalid JSON");
        }
    }
    
    private void handleListRequest(BluetoothDevice device) {
        try {
            List<UserFileMetadata> files = fileRepo.listFiles();
            
            JSONObject response = new JSONObject();
            response.put("op", "list-response");
            
            JSONArray filesArray = new JSONArray();
            for (UserFileMetadata file : files) {
                JSONObject fileObj = new JSONObject();
                fileObj.put("name", file.getName());
                fileObj.put("size", file.getSizeBytes());
                filesArray.put(fileObj);
            }
            
            response.put("files", filesArray);
            response.put("count", files.size());
            
            sendResponse(device, response.toString());
            
            Log.d(TAG, "Sent file list: " + files.size() + " files");
        } catch (Exception e) {
            Log.e(TAG, "Failed to list files", e);
            sendError(device, "Failed to list files");
        }
    }
    
    private void handlePushRequest(BluetoothDevice device, JSONObject request) {
        try {
            String name = request.getString("name");
            String dataBase64 = request.getString("data");
            
            // Decode base64
            byte[] content = Base64.decode(dataBase64, Base64.DEFAULT);
            
            // Save file
            fileRepo.saveFile(name, content);
            
            // Send success response
            JSONObject response = new JSONObject();
            response.put("op", "push-response");
            response.put("status", "ok");
            response.put("name", name);
            response.put("size", content.length);
            
            sendResponse(device, response.toString());
            
            Log.i(TAG, "Saved file: " + name + " (" + content.length + " bytes)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to push file", e);
            sendError(device, "Failed to save file: " + e.getMessage());
        }
    }
    
    private void handlePullRequest(BluetoothDevice device, JSONObject request) {
        try {
            String name = request.getString("name");
            
            // Read file
            byte[] content = fileRepo.readFile(name);
            
            // Encode as base64
            String dataBase64 = Base64.encodeToString(content, Base64.NO_WRAP);
            
            // Send response
            JSONObject response = new JSONObject();
            response.put("op", "pull-response");
            response.put("name", name);
            response.put("size", content.length);
            response.put("data", dataBase64);
            
            sendResponse(device, response.toString());
            
            Log.i(TAG, "Sent file: " + name + " (" + content.length + " bytes)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to pull file", e);
            sendError(device, "Failed to read file: " + e.getMessage());
        }
    }
    
    private void handleRemoveRequest(BluetoothDevice device, JSONObject request) {
        try {
            String name = request.getString("name");
            
            // Delete file
            fileRepo.deleteFile(name);
            
            // Send success response
            JSONObject response = new JSONObject();
            response.put("op", "remove-response");
            response.put("status", "ok");
            response.put("name", name);
            
            sendResponse(device, response.toString());
            
            Log.i(TAG, "Removed file: " + name);
        } catch (Exception e) {
            Log.e(TAG, "Failed to remove file", e);
            sendError(device, "Failed to remove file: " + e.getMessage());
        }
    }
    
    private void sendResponse(BluetoothDevice device, String json) {
        if (gattServer == null || fileSyncChar == null) return;
        
        if (ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
            != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        
        // BLE notifications have max size ~512 bytes, chunk if needed
        int mtu = 512;
        int chunkSize = mtu - 3; // Leave room for ATT overhead
        
        if (data.length <= chunkSize) {
            // Small response, send in one go
            fileSyncChar.setValue(data);
            gattServer.notifyCharacteristicChanged(device, fileSyncChar, false);
        } else {
            // Large response, chunk it
            for (int offset = 0; offset < data.length; offset += chunkSize) {
                int length = Math.min(chunkSize, data.length - offset);
                byte[] chunk = new byte[length];
                System.arraycopy(data, offset, chunk, 0, length);
                
                fileSyncChar.setValue(chunk);
                gattServer.notifyCharacteristicChanged(device, fileSyncChar, false);
                
                // Small delay between chunks to prevent flooding the BLE stack
                try {
                    Thread.sleep(50);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }
    
    private void sendError(BluetoothDevice device, String message) {
        try {
            JSONObject response = new JSONObject();
            response.put("op", "error");
            response.put("message", message);
            sendResponse(device, response.toString());
        } catch (JSONException e) {
            Log.e(TAG, "Failed to send error response", e);
        }
    }
    
    public boolean isAdvertising() {
        return isAdvertising;
    }
    
    public boolean isConnected() {
        return connectedDevice != null;
    }
}
