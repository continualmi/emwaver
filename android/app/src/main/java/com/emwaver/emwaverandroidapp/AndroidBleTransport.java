/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.content.Context;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.os.ParcelUuid;
import android.util.Log;

import androidx.annotation.Nullable;

import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

final class AndroidBleTransport {
    private static final String TAG = "AndroidBleTransport";

    static final UUID SERVICE_UUID = UUID.fromString("45C7158E-0C3B-4E90-A847-452A15B14191");
    static final UUID COMMAND_UUID = UUID.fromString("46C7158E-0C3B-4E90-A847-452A15B14191");
    static final UUID NOTIFY_UUID = UUID.fromString("47C7158E-0C3B-4E90-A847-452A15B14191");
    static final UUID CLIENT_CHARACTERISTIC_CONFIG_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

    private AndroidBleTransport() {}

    interface ScanListener {
        void onDevice(BluetoothDevice device, String displayName, @Nullable String advertisementName);
    }

    interface Listener {
        void onConnected(Connection connection);
        void onDisconnected(BluetoothGatt gatt);
        void onBytes(Connection connection, byte[] data);
        void onMissingCommandCharacteristic(BluetoothGatt gatt);
    }

    static final class ScanSession implements AutoCloseable {
        private final BluetoothLeScanner scanner;
        private final ScanCallback callback;
        private volatile boolean scanning;

        ScanSession(BluetoothLeScanner scanner, ScanCallback callback) {
            this.scanner = scanner;
            this.callback = callback;
        }

        boolean isScanning() {
            return scanning;
        }

        void start() {
            if (scanner == null || callback == null || scanning) {
                return;
            }
            scanner.startScan(scanFilters(), scanSettings(), callback);
            scanning = true;
        }

        @Override
        public void close() {
            if (scanner == null || callback == null || !scanning) {
                scanning = false;
                return;
            }
            try {
                scanner.stopScan(callback);
            } catch (Exception ignored) {
            }
            scanning = false;
        }
    }

    static final class PendingConnection implements AutoCloseable {
        final BluetoothGatt gatt;
        final String displayName;

        PendingConnection(BluetoothGatt gatt, @Nullable String displayName) {
            this.gatt = gatt;
            String name = displayName != null && !displayName.trim().isEmpty()
                    ? displayName.trim()
                    : gatt.getDevice().getAddress();
            this.displayName = name;
        }

        boolean owns(BluetoothGatt gatt) {
            return this.gatt == gatt;
        }

        @Override
        public void close() {
            try {
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                }
            } catch (Exception ignored) {
            }
        }
    }

    static final class Connection implements TransportDeviceConnection, AutoCloseable {
        final BluetoothGatt gatt;
        final BluetoothGattCharacteristic commandCharacteristic;
        final String sessionId;
        final String displayName;
        final TransportDeviceSession session;
        private volatile boolean connected;

        Connection(
                BluetoothGatt gatt,
                BluetoothGattCharacteristic commandCharacteristic,
                @Nullable String displayName,
                boolean connected,
                @Nullable TransportDeviceSession session
        ) {
            this.gatt = gatt;
            this.commandCharacteristic = commandCharacteristic;
            this.sessionId = AndroidBleTransport.sessionId(gatt.getDevice());
            String name = displayName != null && !displayName.trim().isEmpty()
                    ? displayName.trim()
                    : gatt.getDevice().getAddress();
            this.displayName = name;
            this.session = session != null ? session : new DeviceBufferSession(this.sessionId);
            this.connected = connected;
        }

        @Override
        public String sessionId() {
            return sessionId;
        }

        @Override
        public String displayName() {
            return displayName;
        }

        @Override
        public TransportDeviceSession session() {
            return session;
        }

        boolean isOpen() {
            return gatt != null && commandCharacteristic != null && connected;
        }

        boolean owns(BluetoothGatt gatt) {
            return this.gatt == gatt;
        }

        boolean writeSysex(byte[] sysex) {
            return AndroidBleTransport.writeSysex(gatt, commandCharacteristic, connected, sysex);
        }

        @Override
        public void close() {
            connected = false;
            try {
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                }
            } catch (Exception ignored) {
            }
        }
    }

    static String sessionId(@Nullable BluetoothDevice device) {
        if (device == null) return "ble:active";
        return "ble:" + device.getAddress();
    }

    static boolean matchesAdvertisementName(@Nullable String name) {
        return name == null || name.toLowerCase(Locale.US).contains("emwaver");
    }

    @Nullable
    static String advertisementName(@Nullable ScanResult result) {
        if (result == null || result.getDevice() == null) {
            return null;
        }
        String name = result.getDevice().getName();
        if (name == null && result.getScanRecord() != null) {
            name = result.getScanRecord().getDeviceName();
        }
        return name;
    }

    static String displayName(@Nullable ScanResult result) {
        if (result == null || result.getDevice() == null) {
            return "EMWaver BLE";
        }
        String name = advertisementName(result);
        return name != null && !name.trim().isEmpty()
                ? name.trim()
                : result.getDevice().getAddress();
    }

    static String boardType() {
        return "esp32s3";
    }

    static List<ScanFilter> scanFilters() {
        ScanFilter filter = new ScanFilter.Builder()
                .setServiceUuid(new ParcelUuid(SERVICE_UUID))
                .build();
        return Collections.singletonList(filter);
    }

    static ScanSettings scanSettings() {
        return new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
    }

    static BluetoothGatt connect(
            Context context,
            BluetoothDevice device,
            BluetoothGattCallback callback
    ) {
        return device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE);
    }

    static PendingConnection pendingSession(
            Context context,
            BluetoothDevice device,
            @Nullable String displayName,
            BluetoothGattCallback callback
    ) {
        return new PendingConnection(connect(context, device, callback), displayName);
    }

    static PendingConnection openConnection(
            Context context,
            BluetoothDevice device,
            @Nullable String displayName,
            TransportDeviceSession session,
            Listener listener
    ) {
        BluetoothGattCallback callback = gattCallback(displayName, session, listener);
        return pendingSession(context, device, displayName, callback);
    }

    static Connection connectedSession(
            BluetoothGatt gatt,
            BluetoothGattCharacteristic command,
            @Nullable String displayName
    ) {
        return connectedSession(gatt, command, displayName, null);
    }

    static Connection connectedSession(
            BluetoothGatt gatt,
            BluetoothGattCharacteristic command,
            @Nullable String displayName,
            @Nullable TransportDeviceSession session
    ) {
        return new Connection(gatt, command, displayName, true, session);
    }

    static void closeHandles(
            @Nullable AutoCloseable scanSession,
            @Nullable AutoCloseable connection,
            @Nullable AutoCloseable pendingConnection
    ) {
        closeQuietly(scanSession);
        closeQuietly(connection);
        closeQuietly(pendingConnection);
    }

    private static void closeQuietly(@Nullable AutoCloseable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Exception ignored) {
        }
    }

    static void discoverServices(BluetoothGatt gatt) {
        if (!gatt.requestMtu(64)) {
            gatt.discoverServices();
        }
    }

    static void discoverServicesAfterMtu(BluetoothGatt gatt) {
        gatt.discoverServices();
    }

    static ScanSession scanSession(BluetoothLeScanner scanner, ScanListener listener) {
        return new ScanSession(scanner, scanCallback(listener));
    }

    static ScanCallback scanCallback(ScanListener listener) {
        return new ScanCallback() {
            @SuppressLint("MissingPermission")
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (result == null || result.getDevice() == null) {
                    return;
                }
                String name = advertisementName(result);
                if (!matchesAdvertisementName(name)) {
                    return;
                }
                if (listener != null) {
                    listener.onDevice(result.getDevice(), displayName(result), name);
                }
            }
        };
    }

    static BluetoothGattCallback gattCallback(
            @Nullable String displayName,
            TransportDeviceSession session,
            Listener listener
    ) {
        return new BluetoothGattCallback() {
            @SuppressLint("MissingPermission")
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                    discoverServices(gatt);
                } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED && listener != null) {
                    listener.onDisconnected(gatt);
                }
            }

            @SuppressLint("MissingPermission")
            @Override
            public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                discoverServicesAfterMtu(gatt);
            }

            @SuppressLint("MissingPermission")
            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                BluetoothGattCharacteristic command = commandCharacteristic(gatt);
                if (command == null) {
                    if (listener != null) {
                        listener.onMissingCommandCharacteristic(gatt);
                    }
                    gatt.disconnect();
                    return;
                }
                Connection connection = connectedSession(gatt, command, displayName, session);
                enableNotifications(gatt);
                if (listener != null) {
                    listener.onConnected(connection);
                }
            }

            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                if (characteristic == null || !NOTIFY_UUID.equals(characteristic.getUuid())) {
                    return;
                }
                byte[] value = characteristic.getValue();
                if (value == null || listener == null) {
                    return;
                }
                BluetoothGattCharacteristic command = commandCharacteristic(gatt);
                Connection connection = connectedSession(gatt, command, displayName, session);
                listener.onBytes(connection, value);
            }
        };
    }

    @Nullable
    static BluetoothGattCharacteristic commandCharacteristic(BluetoothGatt gatt) {
        BluetoothGattService service = gatt.getService(SERVICE_UUID);
        if (service == null) {
            Log.e(TAG, "BLE EMWaver service missing");
            return null;
        }
        BluetoothGattCharacteristic command = service.getCharacteristic(COMMAND_UUID);
        if (command == null) {
            Log.e(TAG, "BLE command characteristic missing");
        }
        return command;
    }

    static void enableNotifications(BluetoothGatt gatt) {
        BluetoothGattService service = gatt.getService(SERVICE_UUID);
        if (service == null) {
            return;
        }
        BluetoothGattCharacteristic notify = service.getCharacteristic(NOTIFY_UUID);
        if (notify == null) {
            return;
        }
        gatt.setCharacteristicNotification(notify, true);
        BluetoothGattDescriptor cccd = notify.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG_UUID);
        if (cccd != null) {
            cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(cccd);
        }
    }

    static boolean writeSysex(
            @Nullable BluetoothGatt gatt,
            @Nullable BluetoothGattCharacteristic commandCharacteristic,
            boolean connected,
            byte[] sysex
    ) {
        if (gatt == null || commandCharacteristic == null || !connected || sysex == null) {
            return false;
        }
        commandCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        commandCharacteristic.setValue(sysex);
        if (!gatt.writeCharacteristic(commandCharacteristic)) {
            Log.e(TAG, "BLE writeCharacteristic returned false");
            return false;
        }
        return true;
    }
}
