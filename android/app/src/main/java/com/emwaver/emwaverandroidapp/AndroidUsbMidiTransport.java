/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.media.midi.MidiInputPort;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.util.Locale;

final class AndroidUsbMidiTransport {
    private static final String TAG = "AndroidUsbMidiTransport";
    private static final int EMW_USB_VENDOR_ID = 1155;   // 0x0483
    private static final int EMW_USB_PRODUCT_ID = 22336; // 0x5740

    private AndroidUsbMidiTransport() {}

    static String sessionId(@Nullable UsbDevice device) {
        if (device == null) return "usb:active";
        return "usb:" + device.getVendorId() + ":" + device.getProductId() + ":" + device.getDeviceName();
    }

    @Nullable
    static String displayName(@Nullable UsbDevice device) {
        if (device == null) return null;
        String product = device.getProductName();
        if (product != null && !product.trim().isEmpty()) {
            return product.trim();
        }
        String name = device.getDeviceName();
        if (name != null && !name.trim().isEmpty()) {
            return name.trim();
        }
        return "USB " + device.getVendorId() + ":" + device.getProductId();
    }

    static boolean isSupportedRuntimeDevice(@Nullable UsbDevice device) {
        if (device == null) {
            return false;
        }
        if (device.getVendorId() == EMW_USB_VENDOR_ID && device.getProductId() == EMW_USB_PRODUCT_ID) {
            return true;
        }

        String manufacturer = lower(device.getManufacturerName());
        String product = lower(device.getProductName());

        if (product.contains("emwaver") || manufacturer.contains("emwaver")) {
            return true;
        }
        return (manufacturer.contains("espressif") ||
                product.contains("esp32") ||
                product.contains("esp32-s3") ||
                product.contains("s3")) &&
                looksLikeMidi(device);
    }

    static String inferBoardType(@Nullable UsbDevice device, @Nullable String boardTypeHint) {
        String hint = lower(boardTypeHint);
        if (!hint.isEmpty()) {
            return hint;
        }

        String product = lower(device != null ? device.getProductName() : null);
        String manufacturer = lower(device != null ? device.getManufacturerName() : null);
        if (product.contains("esp32") || product.contains("esp32-s3") || product.contains("s3")) {
            return "esp32s3";
        }
        if (manufacturer.contains("espressif")) {
            return "esp32s3";
        }
        return "stm32f042";
    }

    static boolean sendSysex(@Nullable MidiInputPort midiIn, byte[] sysex) {
        if (midiIn == null || sysex == null) {
            return false;
        }
        try {
            midiIn.send(sysex, 0, sysex.length, 0);
            return true;
        } catch (IOException e) {
            Log.e(TAG, "Error writing USB packet", e);
            return false;
        }
    }

    private static boolean looksLikeMidi(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            if (iface == null) {
                continue;
            }
            if (iface.getInterfaceClass() == 1 && iface.getInterfaceSubclass() == 3) {
                return true;
            }
        }
        return false;
    }

    private static String lower(@Nullable String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.US);
    }
}
