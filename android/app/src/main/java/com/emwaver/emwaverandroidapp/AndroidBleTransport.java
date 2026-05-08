/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.content.Context;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.le.ScanFilter;
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

    static String sessionId(@Nullable BluetoothDevice device) {
        if (device == null) return "ble:active";
        return "ble:" + device.getAddress();
    }

    static boolean matchesAdvertisementName(@Nullable String name) {
        return name == null || name.toLowerCase(Locale.US).contains("emwaver");
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

    static void discoverServices(BluetoothGatt gatt) {
        if (!gatt.requestMtu(64)) {
            gatt.discoverServices();
        }
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
