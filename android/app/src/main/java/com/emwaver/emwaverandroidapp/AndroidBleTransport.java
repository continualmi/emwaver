/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.bluetooth.BluetoothDevice;

import androidx.annotation.Nullable;

import java.util.Locale;
import java.util.UUID;

final class AndroidBleTransport {
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
}
