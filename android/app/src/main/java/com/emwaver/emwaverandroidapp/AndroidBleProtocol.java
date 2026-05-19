/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.util.Log;

import androidx.annotation.Nullable;

final class AndroidBleProtocol {
    private static final String TAG = "AndroidBleProtocol";

    private final USBService host;
    private final Object lock = new Object();

    private BluetoothAdapter bluetoothAdapter;
    private AndroidBleTransport.ScanSession scanSession;
    private AndroidBleTransport.PendingConnection pendingConnection;
    private volatile AndroidBleTransport.Connection connection;

    AndroidBleProtocol(USBService host) {
        this.host = host;
    }

    boolean hasOpenConnection() {
        AndroidBleTransport.Connection active = connection;
        return active != null && active.isOpen();
    }

    @Nullable
    String connectedLabel() {
        AndroidBleTransport.Connection active = connection;
        return active != null ? active.displayName : null;
    }

    @SuppressLint("MissingPermission")
    void startScan() {
        if (!host.hasBlePermission()) {
            Log.d(TAG, "BLE scan skipped: Bluetooth permissions missing");
            return;
        }
        ensureAdapter();
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Log.d(TAG, "BLE scan skipped: Bluetooth unavailable or disabled");
            return;
        }
        if (host.hasUsbMidiConnection()) {
            return;
        }
        synchronized (lock) {
            AndroidBleTransport.Connection active = connection;
            if ((active != null && active.isOpen()) || (scanSession != null && scanSession.isScanning())) {
                return;
            }
            if (bluetoothAdapter.getBluetoothLeScanner() == null) {
                return;
            }
            scanSession = AndroidBleTransport.scanSession(
                    bluetoothAdapter.getBluetoothLeScanner(),
                    new AndroidBleTransport.ScanListener() {
                        @SuppressLint("MissingPermission")
                        @Override
                        public void onDevice(BluetoothDevice device, String displayName, @Nullable String advertisementName) {
                            if (!host.hasBlePermission()) {
                                return;
                            }
                            stopScan();
                            host.closeUsbTransport();
                            host.closeWiFiTransport();
                            synchronized (lock) {
                                closeLocked();
                                TransportDeviceSession session = host.setActiveDeviceTarget(
                                        AndroidBleTransport.sessionId(device),
                                        ActiveTransport.BLE);
                                pendingConnection = AndroidBleTransport.openConnection(
                                        host,
                                        device,
                                        displayName,
                                        session,
                                        listener);
                            }
                            Log.d(TAG, "BLE connecting: " + (advertisementName != null ? advertisementName : device.getAddress()));
                        }
                    });
            scanSession.start();
            Log.d(TAG, "BLE scan started");
        }
    }

    @SuppressLint("MissingPermission")
    void stopScan() {
        synchronized (lock) {
            if (scanSession != null && host.hasBlePermission()) {
                scanSession.close();
            }
            scanSession = null;
        }
    }

    @SuppressLint("MissingPermission")
    void close() {
        synchronized (lock) {
            closeLocked();
        }
    }

    @SuppressLint("MissingPermission")
    private void closeLocked() {
        AndroidBleTransport.closeHandles(scanSession, connection, pendingConnection);
        scanSession = null;
        connection = null;
        pendingConnection = null;
        host.clearActiveDeviceTarget(ActiveTransport.BLE);
    }

    @SuppressLint("MissingPermission")
    void writeSysex(byte[] sysex) {
        synchronized (lock) {
            AndroidBleTransport.Connection active = connection;
            if (active == null || !active.isOpen()) {
                host.showToast("No BLE device connected");
                return;
            }
            active.writeSysex(sysex);
        }
    }

    private void ensureAdapter() {
        if (bluetoothAdapter != null) {
            return;
        }
        BluetoothManager manager = (BluetoothManager) host.getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager != null) {
            bluetoothAdapter = manager.getAdapter();
        }
    }

    private final AndroidBleTransport.Listener listener = new AndroidBleTransport.Listener() {
        @Override
        public void onConnected(AndroidBleTransport.Connection connected) {
            synchronized (lock) {
                AndroidBleTransport.PendingConnection pending = pendingConnection;
                if (pending != null && !pending.owns(connected.gatt)) {
                    connected.close();
                    return;
                }
                connection = connected;
                host.setActiveConnection(connection);
                pendingConnection = null;
            }
            host.setConnectedBoardType(AndroidBleTransport.boardType());
            host.showToast("BLE Connected!");
            host.queryFirmwareVersionAsync();
        }

        @Override
        public void onDisconnected(BluetoothGatt gatt) {
            synchronized (lock) {
                AndroidBleTransport.Connection active = connection;
                AndroidBleTransport.PendingConnection pending = pendingConnection;
                if ((pending != null && pending.owns(gatt)) || (active != null && active.owns(gatt))) {
                    closeLocked();
                }
            }
            startScan();
        }

        @Override
        public void onBytes(AndroidBleTransport.Connection source, byte[] data) {
            TransportDeviceSession session;
            synchronized (lock) {
                AndroidBleTransport.Connection active = connection;
                if (active == null || !active.owns(source.gatt)) {
                    return;
                }
                session = active.session();
            }
            host.feedSysexBytes(data, 0, data.length, session);
        }

        @Override
        public void onMissingCommandCharacteristic(BluetoothGatt gatt) {
            Log.e(TAG, "BLE command characteristic unavailable");
        }
    };
}
