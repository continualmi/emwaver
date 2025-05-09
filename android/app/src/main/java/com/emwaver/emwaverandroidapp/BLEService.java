package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

public class BLEService extends Service {

    static {
        System.loadLibrary("native-lib");
    }

    private static final String TAG = "BLEService";

    // Notification constants
    private static final String NOTIFICATION_CHANNEL_ID = "emwaver_ble_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static final String ACTION_CONNECT = "com.emwaver.emwaverandroidapp.ACTION_CONNECT";
    private static final String ACTION_DISCONNECT = "com.emwaver.emwaverandroidapp.ACTION_DISCONNECT";
    
    // EMWaver BLE Service and Characteristic UUIDs
    // These must match the UUIDs defined in the ESP32 firmware
    private static final UUID SERVICE_UUID = 
        UUID.fromString("45c7158e-0c3b-4e90-a847-452a15b14191");
    private static final UUID CMD_CHAR_UUID = 
        UUID.fromString("46c7158e-0c3b-4e90-a847-452a15b14191");
    private static final UUID NOTIF_CHAR_UUID = 
        UUID.fromString("47c7158e-0c3b-4e90-a847-452a15b14191");
    
    // GATT Client configuration descriptor UUID
    private static final UUID CLIENT_CONFIG_DESCRIPTOR_UUID = 
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // Bluetooth components
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    private BluetoothGatt bluetoothGatt;
    private BluetoothGattCharacteristic cmdCharacteristic;
    private BluetoothGattCharacteristic notifCharacteristic;
    
    // Connection state variables
    private boolean isConnected = false;
    private int connectionRetryCount = 0;
    private static final int MAX_RETRY_COUNT = 3;
    private boolean isReconnecting = false;
    private int serviceDiscoveryRetryCount = 0;
    private static final int MAX_SERVICE_DISCOVERY_RETRIES = 3;
    private boolean isScanningInProgress = false;
    
    private final IBinder binder = new LocalBinder();
    private Handler handler = new Handler(Looper.getMainLooper());

    // Variables for speed calculation (match USBService implementation)
    private long totalBytesReceived = 0;
    private long firstPacketTimeMillis = 0;
    private long lastPacketReceivedTime = 0;
    private long lastLogTimeMillis = 0;
    
    // Store firmware version information
    private String firmwareVersion = "Unknown";

    // Native method declarations
    public native void storeBulkPkt(byte[] data);
    public native byte[] getCommand();
    public native Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
    public native int getStatusNumber();
    public native void clearBuffer();
    public native int getBufferLength();
    public native void loadBuffer(byte[] data);
    public native byte[] getBuffer();
    public native void invertBuffer();

    public class LocalBinder extends Binder {
        public BLEService getService() {
            return BLEService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        bluetoothManager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            bluetoothAdapter = bluetoothManager.getAdapter();
        }
        
        // Create notification channel for Android O and above
        createNotificationChannel();
        
        // Start as a foreground service with initial "Not connected" notification
        startForeground(NOTIFICATION_ID, createNotification("Not connected"));
        
        Log.d(TAG, "BLE Service created");
    }

    // Create the notification channel (required for Android O and above)
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "EMWaver BLE Connection",
                    NotificationManager.IMPORTANCE_LOW); // LOW importance to avoid sound/vibration
            
            channel.setDescription("Manages EMWaver device connections");
            channel.enableLights(true);
            channel.setLightColor(Color.BLUE);
            channel.setShowBadge(true);
            
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            notificationManager.createNotificationChannel(channel);
            
            Log.d(TAG, "Notification channel created");
        }
    }
    
    // Create and return a notification with the current status
    private Notification createNotification(String status) {
        // Create pending intents for actions
        PendingIntent contentIntent = createLaunchAppIntent();
        PendingIntent connectIntent = createActionIntent(ACTION_CONNECT);
        PendingIntent disconnectIntent = createActionIntent(ACTION_DISCONNECT);
        
        // Build the notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setContentTitle("EMWaver BLE")
                .setContentText(status)
                .setSmallIcon(R.drawable.emwaver_vector) // Using the new vector drawable
                .setContentIntent(contentIntent)
                .setOngoing(true);
                
        // Add action buttons based on current connection status
        if (isConnected) {
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Disconnect", disconnectIntent);
        } else {
            builder.addAction(android.R.drawable.ic_menu_search, "Connect", connectIntent);
        }
        
        return builder.build();
    }
    
    // Update notification with current status
    private void updateNotification(String status) {
        NotificationManager notificationManager = 
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.notify(NOTIFICATION_ID, createNotification(status));
        }
    }
    
    // Create pending intent to launch the main activity
    private PendingIntent createLaunchAppIntent() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(this, 0, intent, flags);
    }
    
    // Create pending intent for notification actions
    private PendingIntent createActionIntent(String action) {
        Intent intent = new Intent(this, BLEService.class);
        intent.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getService(this, 0, intent, flags);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            String action = intent.getAction();
            Log.d(TAG, "Received action: " + action);
            
            switch (action) {
                case ACTION_CONNECT:
                    updateNotification("Scanning for EMWaver...");
                    startScan();
                    break;
                case ACTION_DISCONNECT:
                    updateNotification("Disconnecting...");
                    disconnectGatt();
                    // Update notification after a brief delay to reflect disconnected state
                    handler.postDelayed(() -> updateNotification("Not connected"), 500);
                    break;
            }
        }
        
        // If we get started by the system (after reboot, etc.),
        // automatically try to connect to the device
        if (!isConnected && bluetoothAdapter != null && bluetoothAdapter.isEnabled()) {
            startScan();
        }
        
        return START_STICKY;
    }

    // Public method to be called from EMWaverFragment to disconnect
    public void disconnect() {
        Log.d(TAG, "Disconnect called from UI");
        updateNotification("Disconnecting...");
        disconnectGatt();
        // Ensure UI and notification reflect the disconnected state immediately
        isConnected = false; // Explicitly set isConnected to false
        firmwareVersion = "Unknown"; // Reset firmware version
        broadcastConnectionStatus(false);
        updateNotification("Not connected");
    }

    @Override
    public void onDestroy() {
        disconnectGatt();
        super.onDestroy();
        Log.d(TAG, "BLE Service destroyed");
    }

    // Check if all required BLE permissions are granted
    private boolean hasRequiredPermissions() {
        // Basic location permission required for BLE scanning on all Android versions
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        
        // Additional permissions for Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) 
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        
        return true;
    }

    // BLE scan callback
    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String deviceName = null;
            
            // Check permission before calling getName()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                        == PackageManager.PERMISSION_GRANTED) {
                    deviceName = device.getName();
                }
            } else {
                deviceName = device.getName();
            }
            
            if (deviceName != null && deviceName.equals("EMWaver")) {
                Log.d(TAG, "Found EMWaver device: " + device.getAddress());
                connectToDevice(device);
                stopScan();
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            Log.e(TAG, "BLE Scan failed with error: " + errorCode);
            
            // Show toast message for common errors
            switch (errorCode) {
                case ScanCallback.SCAN_FAILED_ALREADY_STARTED:
                    showToast("Scan failed: already started");
                    break;
                case ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED:
                    showToast("Scan failed: app registration failed");
                    break;
                case ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED:
                    showToast("Scan failed: feature unsupported");
                    break;
                default:
                    showToast("Scan failed with code: " + errorCode);
                    break;
            }
        }
    };

    // BLE GATT callback
    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            isReconnecting = false;
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.i(TAG, "Connected to GATT server.");
                    showToast("Connected to EMWaver device");
                    updateNotification("Connected to EMWaver");
                    
                    // Broadcast connection status
                    broadcastConnectionStatus(true);
                    
                    // Reset retry count on successful connection
                    connectionRetryCount = 0;
                    
                    // Request high priority connection for lower latency
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                    != PackageManager.PERMISSION_GRANTED) {
                                showToast("Missing BLUETOOTH_CONNECT permission");
                                return;
                            }
                        }
                        boolean prioritySet = gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
                        Log.d(TAG, "Requested high connection priority, success: " + prioritySet);
                    }
                    
                    // Request MTU of 256 bytes for faster data transfer
                    // We'll start service discovery after MTU negotiation completes
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                    != PackageManager.PERMISSION_GRANTED) {
                                showToast("Missing BLUETOOTH_CONNECT permission");
                                return;
                            }
                        }
                        boolean mtuRequestSuccess = gatt.requestMtu(256);
                        Log.d(TAG, "Requested MTU of 256 bytes, request initiated: " + mtuRequestSuccess);
                        // Service discovery will be started in onMtuChanged callback
                    } else {
                        // For devices that don't support MTU requests, start service discovery immediately
                        startServiceDiscovery(gatt);
                    }
                    
                    isConnected = true;
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    Log.i(TAG, "Disconnected from GATT server.");
                    isConnected = false;
                    showToast("Disconnected from EMWaver device");
                    updateNotification("Disconnected from EMWaver");
                    
                    // Reset firmware version on disconnection
                    firmwareVersion = "Unknown";
                    
                    // Broadcast connection status
                    broadcastConnectionStatus(false);
                    
                    // Try to reconnect if disconnected unexpectedly and not explicitly disconnected
                    if (bluetoothGatt != null && connectionRetryCount < MAX_RETRY_COUNT && !isReconnecting) {
                        connectionRetryCount++;
                        Log.d(TAG, "Attempting to reconnect: " + connectionRetryCount);
                        updateNotification("Reconnecting... Attempt " + connectionRetryCount);
                        
                        // Get reference to device before closing GATT
                        BluetoothDevice device = gatt.getDevice();
                        
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                    != PackageManager.PERMISSION_GRANTED) {
                                return;
                            }
                        }
                        
                        gatt.close();
                        
                        // Reconnect after a small delay
                        isReconnecting = true;
                        handler.postDelayed(() -> connectToDevice(device), 1000);
                    } else if (connectionRetryCount >= MAX_RETRY_COUNT) {
                        updateNotification("Reconnection failed after " + MAX_RETRY_COUNT + " attempts");
                    }
                }
            } else {
                Log.w(TAG, "Connection state change failed with status: " + status);
                isConnected = false;
                updateNotification("Connection error: " + status);
                
                // Try to reconnect on error
                if (connectionRetryCount < MAX_RETRY_COUNT && !isReconnecting) {
                    connectionRetryCount++;
                    Log.d(TAG, "Connection failed, retrying: " + connectionRetryCount + ", error: " + status);
                    updateNotification("Reconnecting... Attempt " + connectionRetryCount);
                    
                    // Get reference to device before closing GATT
                    BluetoothDevice device = gatt.getDevice();
                    
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                != PackageManager.PERMISSION_GRANTED) {
                            return;
                        }
                    }
                    
                    gatt.close();
                    
                    // Reconnect after a small delay
                    isReconnecting = true;
                    handler.postDelayed(() -> connectToDevice(device), 1000);
                } else {
                    connectionRetryCount = 0;
                    disconnectGatt();
                    showToast("Connection failed after multiple attempts");
                    updateNotification("Connection failed after " + MAX_RETRY_COUNT + " attempts");
                }
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "MTU changed to: " + mtu + " bytes");
                
                // Adjust packet size for transmitBuffer method based on new MTU
                if (mtu > 23) {  // Only adjust if we got a larger MTU than default
                    // MTU includes 3 bytes overhead, so actual data payload is mtu-3
                    int maxPacketSize = mtu - 3;
                    Log.d(TAG, "Max packet size: " + maxPacketSize + " bytes");
                }
                
                // Now start service discovery after MTU change is complete
                handler.postDelayed(() -> startServiceDiscovery(gatt), 100);
            } else {
                Log.w(TAG, "MTU change failed with status: " + status);
                // Even if MTU change fails, we should still try to discover services
                startServiceDiscovery(gatt);
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                // First log all available services and characteristics for debugging
                List<BluetoothGattService> services = gatt.getServices();
                Log.d(TAG, "========================");
                Log.d(TAG, "Found " + services.size() + " services on device:");
                for (BluetoothGattService svc : services) {
                    Log.d(TAG, "Service: " + svc.getUuid().toString());
                    List<BluetoothGattCharacteristic> characteristics = svc.getCharacteristics();
                    for (BluetoothGattCharacteristic ch : characteristics) {
                        Log.d(TAG, "  Characteristic: " + ch.getUuid().toString() + 
                              " Properties: " + getPropertiesString(ch.getProperties()));
                    }
                }
                Log.d(TAG, "Looking for our service UUID: " + SERVICE_UUID);
                Log.d(TAG, "========================");
                
                BluetoothGattService service = gatt.getService(SERVICE_UUID);
                if (service != null) {
                    // Reset service discovery retry count on success
                    serviceDiscoveryRetryCount = 0;
                    
                    cmdCharacteristic = service.getCharacteristic(CMD_CHAR_UUID);
                    notifCharacteristic = service.getCharacteristic(NOTIF_CHAR_UUID);
                    
                    Log.d(TAG, "Found EMWaver service and characteristics");
                    Log.d(TAG, "CMD Char: " + (cmdCharacteristic != null));
                    Log.d(TAG, "NOTIF Char: " + (notifCharacteristic != null));
                    
                    // Enable notifications
                    if (notifCharacteristic != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                    != PackageManager.PERMISSION_GRANTED) {
                                showToast("Missing BLUETOOTH_CONNECT permission");
                                return;
                            }
                        }
                        
                        boolean success = gatt.setCharacteristicNotification(notifCharacteristic, true);
                        Log.d(TAG, "Set characteristic notification: " + success);
                        
                        // Enable notifications on the client side
                        BluetoothGattDescriptor descriptor = notifCharacteristic.getDescriptor(CLIENT_CONFIG_DESCRIPTOR_UUID);
                        if (descriptor != null) {
                            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            gatt.writeDescriptor(descriptor);
                            Log.d(TAG, "Notification descriptor write initiated");
                        } else {
                            Log.e(TAG, "Client config descriptor not found");
                        }
                    } else {
                        Log.e(TAG, "Notification characteristic not found");
                    }
                } else {
                    Log.w(TAG, "EMWaver service not found!");
                    
                    // Try to rediscover services a few times before giving up
                    if (serviceDiscoveryRetryCount < MAX_SERVICE_DISCOVERY_RETRIES) {
                        serviceDiscoveryRetryCount++;
                        Log.d(TAG, "Retrying service discovery attempt " + serviceDiscoveryRetryCount);
                        
                        // Check permissions
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                    != PackageManager.PERMISSION_GRANTED) {
                                showToast("Missing BLUETOOTH_CONNECT permission");
                                return;
                            }
                        }
                        
                        // Retry after a delay
                        handler.postDelayed(() -> {
                            if (bluetoothGatt != null) {
                                bluetoothGatt.discoverServices();
                            }
                        }, 1000);
                    } else {
                        showToast("EMWaver BLE service not found after multiple attempts");
                        Log.e(TAG, "Service discovery failed after " + serviceDiscoveryRetryCount + " attempts");
                        serviceDiscoveryRetryCount = 0;
                    }
                }
            } else {
                Log.w(TAG, "Service discovery failed with status: " + status);
                
                // Retry on failure
                if (serviceDiscoveryRetryCount < MAX_SERVICE_DISCOVERY_RETRIES) {
                    serviceDiscoveryRetryCount++;
                    Log.d(TAG, "Service discovery failed, retrying: " + serviceDiscoveryRetryCount);
                    
                    // Check permissions
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (ActivityCompat.checkSelfPermission(BLEService.this, Manifest.permission.BLUETOOTH_CONNECT) 
                                != PackageManager.PERMISSION_GRANTED) {
                            return;
                        }
                    }
                    
                    // Retry after a delay
                    handler.postDelayed(() -> {
                        if (bluetoothGatt != null) {
                            bluetoothGatt.discoverServices();
                        }
                    }, 1000);
                } else {
                    showToast("Service discovery failed after multiple attempts");
                    Log.e(TAG, "Service discovery failed after " + serviceDiscoveryRetryCount + " attempts");
                    serviceDiscoveryRetryCount = 0;
                }
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (characteristic.getUuid().equals(NOTIF_CHAR_UUID)) {
                byte[] data = characteristic.getValue();
                if (data != null && data.length > 0) {
                    processReceivedData(data);
                }
            }
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                //Log.d(TAG, "Write successful");
            } else {
                Log.e(TAG, "Write failed with status: " + status);
            }
        }
        
        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Descriptor write successful");
                if (descriptor.getCharacteristic().getUuid().equals(NOTIF_CHAR_UUID)) {
                    Log.d(TAG, "Notifications successfully enabled");
                    showToast("Ready to communicate with EMWaver");
                    updateNotification("Connected to EMWaver (Ready)");
                }
            } else {
                Log.e(TAG, "Descriptor write failed: " + status);
                updateNotification("Connection issue: Descriptor write failed");
            }
        }
    };

    // Helper method to show toasts on the main thread
    private void showToast(final String message) {
        handler.post(() -> Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show());
    }

    // Process data received from BLE device
    private void processReceivedData(byte[] data) {
        long currentTime = System.currentTimeMillis();
        lastPacketReceivedTime = currentTime;

        if (totalBytesReceived == 0) {
            firstPacketTimeMillis = currentTime;
            lastLogTimeMillis = currentTime;
        }

        totalBytesReceived += data.length;
        storeBulkPkt(data);

        if (currentTime - lastLogTimeMillis > 1000) {
            double speedBps = getReceptionSpeedBps();
            Log.i(TAG, String.format("Reception Speed: %.2f bps", speedBps));
            lastLogTimeMillis = currentTime;
        }
    }

    // Start scanning for BLE devices
    public void startScan() {
        // Check if a scan is already in progress
        if (isScanningInProgress) {
            Log.d(TAG, "Scan already in progress, ignoring new scan request");
            return;
        }

        if (!hasRequiredPermissions()) {
            showToast("Missing required Bluetooth permissions");
            Log.e(TAG, "Cannot start scan - missing permissions");
            updateNotification("Error: Missing Bluetooth permissions");
            return;
        }
        
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            showToast("Bluetooth is not enabled");
            Log.e(TAG, "Bluetooth is not enabled");
            updateNotification("Error: Bluetooth is not enabled");
            return;
        }

        bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();
        if (bluetoothLeScanner == null) {
            showToast("BLE scanner not available");
            Log.e(TAG, "BLE scanner not available");
            updateNotification("Error: BLE scanner not available");
            return;
        }

        // Set up scan filters to only show EMWaver devices
        List<ScanFilter> filters = new ArrayList<>();
        ScanFilter emwaverFilter = new ScanFilter.Builder()
            .setDeviceName("EMWaver")
            .build();
        filters.add(emwaverFilter);

        // Set up scan settings
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        try {
            // Check permissions before scanning
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) 
                        != PackageManager.PERMISSION_GRANTED) {
                    showToast("Missing BLUETOOTH_SCAN permission");
                    updateNotification("Error: Missing BLUETOOTH_SCAN permission");
                    return;
                }
            } else if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                       != PackageManager.PERMISSION_GRANTED) {
                showToast("Missing ACCESS_FINE_LOCATION permission");
                updateNotification("Error: Missing location permission");
                return;
            }
            
            // Start scanning
            bluetoothLeScanner.startScan(filters, settings, scanCallback);
            isScanningInProgress = true;
            Log.d(TAG, "Started BLE scan");
            showToast("Scanning for EMWaver device...");
            updateNotification("Scanning for EMWaver...");
            
            // Stop scan after 10 seconds to conserve battery
            handler.postDelayed(() -> {
                stopScan();
                // Only update notification if still not connected
                if (!isConnected) {
                    updateNotification("Device not found. Tap Connect to try again.");
                }
            }, 10000);
        } catch (Exception e) {
            Log.e(TAG, "Error starting scan", e);
            showToast("Error starting BLE scan: " + e.getMessage());
            updateNotification("Error starting scan: " + e.getMessage());
            isScanningInProgress = false;
        }
    }

    // Stop BLE scanning
    public void stopScan() {
        if (bluetoothLeScanner != null && isScanningInProgress) {
            try {
                // Check permissions
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_SCAN) 
                            != PackageManager.PERMISSION_GRANTED) {
                        return;
                    }
                }
                
                bluetoothLeScanner.stopScan(scanCallback);
                isScanningInProgress = false;
                Log.d(TAG, "Stopped BLE scan");
            } catch (Exception e) {
                Log.e(TAG, "Error stopping scan", e);
                isScanningInProgress = false;
            }
        }
    }

    // Connect to a BLE device
    private void connectToDevice(BluetoothDevice device) {
        // Stop scanning as we're now connecting to a device
        stopScan();
        
        // Check connect permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                showToast("Missing BLUETOOTH_CONNECT permission");
                return;
            }
        }
        
        try {
            Log.d(TAG, "Connecting to device: " + device.getAddress());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                bluetoothGatt = device.connectGatt(this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                bluetoothGatt = device.connectGatt(this, false, gattCallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error connecting to device", e);
            showToast("Connection error: " + e.getMessage());
        }
    }

    // Disconnect from GATT server
    public void disconnectGatt() {
        if (bluetoothGatt != null) {
            try {
                // Check permission
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                            != PackageManager.PERMISSION_GRANTED) {
                        return;
                    }
                }
                
                bluetoothGatt.disconnect();
                bluetoothGatt.close();
                bluetoothGatt = null;
                isConnected = false;
                firmwareVersion = "Unknown"; // Reset firmware version
                Log.d(TAG, "Disconnected from GATT server");
            } catch (Exception e) {
                Log.e(TAG, "Error disconnecting", e);
            }
        }
    }

    // Check if BLE is connected
    public boolean checkConnection() {
        return isConnected && bluetoothGatt != null;
    }

    // Write data to the BLE device
    public void write(byte[] bytes) {
        if (bytes != null && isConnected && cmdCharacteristic != null) {
            try {
                // Start timing
                long startTime = System.currentTimeMillis();
                
                // Check permission
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                            != PackageManager.PERMISSION_GRANTED) {
                        showToast("Missing BLUETOOTH_CONNECT permission");
                        return;
                    }
                }
                
                cmdCharacteristic.setValue(bytes);
                // Use write without response to avoid acknowledgment delay
                //cmdCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                
                // Aggressively retry until success or max attempts reached
                boolean success = false;
                int maxRetries = 100; // High retry count
                int retryCount = 0;
                
                while (!success && retryCount < maxRetries) {
                    success = bluetoothGatt.writeCharacteristic(cmdCharacteristic);
                    if (!success) {
                        retryCount++;
                        if (retryCount % 10 == 0) {
                            Log.w(TAG, "Write attempt failed, still trying: " + retryCount + "/" + maxRetries);
                        }
                    }
                }
                
                // End timing and log results
                long endTime = System.currentTimeMillis();
                long elapsedTime = endTime - startTime;
                //Log.i(TAG, "BLE write operation took " + elapsedTime + "ms (retries: " + retryCount + ")");
                
                if (!success) {
                    Log.e(TAG, "Failed to write characteristic after " + maxRetries + " attempts");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error writing characteristic", e);
                showToast("Write error: " + e.getMessage());
            }
        } else {
            if (!isConnected) {
                showToast("No BLE device connected");
            } else if (cmdCharacteristic == null) {
                showToast("Command characteristic not available");
            }
        }
    }

    // Send a command and wait for response
    public byte[] sendCommand(byte[] command, int timeout) {
        if (command == null || !isConnected || cmdCharacteristic == null) {
            if (!isConnected) {
                showToast("No BLE device connected");
            } else if (cmdCharacteristic == null) {
                showToast("Command characteristic not available");
            }
            return null;
        }
        
        try {
            // Start timing
            long startTime = System.currentTimeMillis();
            
            clearBuffer(); // Clear any existing data
            
            // Check permission
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                        != PackageManager.PERMISSION_GRANTED) {
                    showToast("Missing BLUETOOTH_CONNECT permission");
                    return null;
                }
            }
            
            cmdCharacteristic.setValue(command);
            // Use write without response to avoid acknowledgment delay
            //cmdCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            
            // Aggressively retry until success or max attempts reached
            boolean writeSuccess = false;
            int maxRetries = 100; // High retry count
            int retryCount = 0;
            
            while (!writeSuccess && retryCount < maxRetries) {
                writeSuccess = bluetoothGatt.writeCharacteristic(cmdCharacteristic);
                if (!writeSuccess) {
                    retryCount++;
                    if (retryCount % 10 == 0) {
                        Log.w(TAG, "Write attempt failed, still trying: " + retryCount + "/" + maxRetries);
                    }
                }
            }
            
            if (!writeSuccess) {
                Log.e(TAG, "Failed to initiate write characteristic after " + maxRetries + " attempts");
                return null;
            }
            
            // Wait for response
            byte[] response = null;
            
            while (System.currentTimeMillis() - startTime < timeout) {
                response = getCommand();
                if (response != null && response.length > 0) {
                    break;
                }
                Thread.sleep(10); // Small delay to prevent busy waiting
            }
            
            // End timing and log results
            long endTime = System.currentTimeMillis();
            long elapsedTime = endTime - startTime;
            Log.i(TAG, "BLE command operation took " + elapsedTime + "ms (retries: " + retryCount + ")");
            
            // If we timed out waiting for a response
            if (response == null || response.length == 0) {
                Log.e(TAG, "Command timed out or received empty response");
            }
            
            return response;
        } catch (Exception e) {
            Log.e(TAG, "Error in sendCommand: ", e);
            return null;
        }
    }

    // Send a packet to the device
    public void sendPacket(byte[] data) {
        if (data != null && isConnected && cmdCharacteristic != null) {
            try {
                // Check permission
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                            != PackageManager.PERMISSION_GRANTED) {
                        showToast("Missing BLUETOOTH_CONNECT permission");
                        return;
                    }
                }
                
                cmdCharacteristic.setValue(data);
                
                // Aggressively retry until success or max attempts reached
                boolean success = false;
                int maxRetries = 100; // High retry count
                int retryCount = 0;
                
                while (!success && retryCount < maxRetries) {
                    success = bluetoothGatt.writeCharacteristic(cmdCharacteristic);
                    if (!success) {
                        retryCount++;
                        if (retryCount % 10 == 0) {
                            Log.w(TAG, "Send packet attempt failed, still trying: " + retryCount + "/" + maxRetries);
                        }
                    }
                }
                
                if (!success) {
                    Log.e(TAG, "Failed to write packet after " + maxRetries + " attempts");
                }
            } catch (Exception e) {
                Log.e(TAG, "Error writing packet", e);
                showToast("Packet send error: " + e.getMessage());
            }
        } else {
            if (!isConnected) {
                showToast("No BLE device connected");
            } else if (cmdCharacteristic == null) {
                showToast("Command characteristic not available");
            }
        }
    }

    // Method to calculate reception speed in bits per second
    public double getReceptionSpeedBps() {
        if (totalBytesReceived == 0 || firstPacketTimeMillis == 0) {
            return 0.0;
        }

        long currentTime = System.currentTimeMillis();
        long elapsedTimeMillis = currentTime - firstPacketTimeMillis;

        if (elapsedTimeMillis <= 0) {
            return 0.0;
        }

        double elapsedTimeSeconds = elapsedTimeMillis / 1000.0;
        return (totalBytesReceived * 8) / elapsedTimeSeconds;
    }

    // Transmit buffer method
    public void transmitBuffer() {
        byte[] javaBuffer = getBuffer();
        if (javaBuffer == null || javaBuffer.length == 0) {
            Log.e(TAG, "Empty buffer, nothing to transmit");
            return;
        }

        // Clear the buffer after storing it in javaBuffer
        clearBuffer();

        int nativeBufferSize = javaBuffer.length;
        final int maxPacketSize = 200;  // Maximum packet size (allowed to go this high)
        final int minPacketSize = 128;  // Minimum packet size we'll use
        final int initialPacketSize = 188; // Starting point (matching ~100kbps)
        int currentPacketSize = maxPacketSize; // Start with max for fill phase

        // Use a constant delay of 15ms (BLE connection interval)
        final int fixedDelayMs = 15;
        final long delayNanos = fixedDelayMs * 1_000_000L;

        // Simple buffer thresholds - target is 2048
        final int targetBufferLevel = 2048;  // Ideal buffer level
        final int bufferHighThreshold = 3000; // If above this, we reduce packet size
        final int bufferLowThreshold = 1000;  // If below this, we increase packet size
        final int initialFillBytes = 2048;    // Bytes to send before enabling flow control

        Log.i(TAG, "Starting buffer transmission: " + nativeBufferSize + " bytes, Fixed Delay: " + fixedDelayMs + "ms");
        Log.i(TAG, "Flow control: Decrease if buffer > " + bufferHighThreshold + ", Increase if buffer < " + bufferLowThreshold);

        for (int i = 0; i < nativeBufferSize;) {
            // Get ESP32 buffer status BEFORE sending next packet
            int bufferStatus = getStatusNumber();

            Log.d(TAG, "Buffer Status: " + bufferStatus + " | Pkt Size: " + currentPacketSize);
            
            // Calculate end based on current packet size
            int end = Math.min(i + currentPacketSize, nativeBufferSize);
            byte[] packet = getBufferRange(javaBuffer, i, end);
            
            // Send the packet
            write(packet);
            
            // Apply flow control after every packet once we've sent the initial fill
            if (i >= initialFillBytes) {
                // Simple flow control - check buffer level and adjust packet size
                if (bufferStatus > bufferHighThreshold) {
                    // Buffer too full, slow down
                    int newSize = Math.max(minPacketSize, currentPacketSize - 32);
                    if (newSize != currentPacketSize) {
                        currentPacketSize = newSize;
                    }
                } else if (bufferStatus < bufferLowThreshold) {
                    // Buffer too empty, speed up
                    int newSize = Math.min(maxPacketSize, currentPacketSize + 32);
                    if (newSize != currentPacketSize) {
                        currentPacketSize = newSize;
                    }
                } else {
                    // In the target range, stay at current size
                    if (currentPacketSize != initialPacketSize && Math.abs(bufferStatus - targetBufferLevel) < 100) {
                        // If we're very close to target and not at initial size, nudge toward it
                        if (currentPacketSize < initialPacketSize) {
                            currentPacketSize = Math.min(initialPacketSize, currentPacketSize + 16);
                        } else if (currentPacketSize > initialPacketSize) {
                            currentPacketSize = Math.max(initialPacketSize, currentPacketSize - 16);
                        }
                    }
                }
            } else {
                // During initial fill, keep max packet size
                currentPacketSize = maxPacketSize;
            }
            
            // Fixed delay between packets using precise busy-wait
            long startDelay = System.nanoTime();
            while (System.nanoTime() - startDelay < delayNanos) {
                Thread.yield();
            }
            
            // Move to next packet
            i = end;
        }
        
        Log.d(TAG, "BEFORE_RELOAD: Total bytes sent: " + totalBytesReceived + 
              " (" + (totalBytesReceived * 8) + " bits)");
        
        // Add a delay to allow any in-flight notifications to be processed
        try {
            Log.d(TAG, "Adding 100ms delay to allow pending notifications to arrive");
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Log.e(TAG, "Delay interrupted", e);
        }
        
        // Clear the buffer again to remove any status packets that were received during transmission
        clearBuffer();
        Log.d(TAG, "SECOND_CLEAR: Buffer cleared again before reload to remove status packets");
        
        // Reload the buffer with javaBuffer after transmission
        loadBuffer(javaBuffer);
        
        Log.d(TAG, "AFTER_RELOAD: Buffer now contains " + getBufferLength() + " bytes (" + 
              (getBufferLength() * 8) + " bits)");
        
        Log.i(TAG, "Buffer transmission complete: " + nativeBufferSize + " bytes sent");
    }

    // Helper method for buffer range
    private byte[] getBufferRange(byte[] buffer, int start, int end) {
        if (start < 0 || end > buffer.length || start >= end) {
            return new byte[0];
        }
        return Arrays.copyOfRange(buffer, start, end);
    }

    // Get log status
    public int getLogStatus() {
        int bufferStatus = getStatusNumber();
        int currentBufferLength = getBufferLength();
        return bufferStatus;
    }

    // Helper method to send a string command directly
    public void sendString(String command) {
        if (command == null || command.isEmpty()) {
            return;
        }
        
        byte[] bytes = command.getBytes();
        sendPacket(bytes);
    }

    // Helper method to translate BLE characteristic properties to readable string
    private String getPropertiesString(int properties) {
        StringBuilder sb = new StringBuilder();
        if ((properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0) {
            sb.append("READ ");
        }
        if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) {
            sb.append("WRITE ");
        }
        if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
            sb.append("WRITE_NO_RESPONSE ");
        }
        if ((properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
            sb.append("NOTIFY ");
        }
        if ((properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) {
            sb.append("INDICATE ");
        }
        return sb.toString();
    }

    // Helper method to start service discovery with permission check
    private void startServiceDiscovery(BluetoothGatt gatt) {
        if (gatt == null) {
            Log.e(TAG, "Cannot start service discovery - gatt is null");
            return;
        }
        
        // Check permissions
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                showToast("Missing BLUETOOTH_CONNECT permission");
                return;
            }
        }
        
        boolean discoverStarted = gatt.discoverServices();
        Log.d(TAG, "Service discovery started: " + discoverStarted);
    }

    // Broadcast connection status
    private void broadcastConnectionStatus(boolean isConnected) {
        Intent intent = new Intent(BLEReceiver.ACTION_BLE_CONNECTION_STATUS);
        intent.putExtra(BLEReceiver.EXTRA_CONNECTION_STATUS, isConnected);
        sendBroadcast(intent);
        Log.d(TAG, "Broadcasting connection status: " + (isConnected ? "connected" : "disconnected"));
    }

    // Getter and setter for firmware version
    public String getFirmwareVersion() {
        return firmwareVersion;
    }
    
    public void setFirmwareVersion(String version) {
        this.firmwareVersion = version;
    }
} 