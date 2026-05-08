/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiReceiver;
import android.util.Log;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.util.HashMap;
import java.util.Locale;

final class AndroidUsbMidiTransport {
    private static final String TAG = "AndroidUsbMidiTransport";
    private static final int EMW_USB_VENDOR_ID = 1155;   // 0x0483
    private static final int EMW_USB_PRODUCT_ID = 22336; // 0x5740

    private AndroidUsbMidiTransport() {}

    static final class OpenPorts {
        final MidiInputPort input;
        final MidiOutputPort output;

        OpenPorts(@Nullable MidiInputPort input, @Nullable MidiOutputPort output) {
            this.input = input;
            this.output = output;
        }
    }

    static final class Connection implements AutoCloseable {
        final UsbDevice usbDevice;
        final MidiDevice midiDevice;
        final MidiInputPort input;
        final MidiOutputPort output;
        final String sessionId;
        final String displayName;

        private Connection(
                UsbDevice usbDevice,
                MidiDevice midiDevice,
                MidiInputPort input,
                MidiOutputPort output,
                @Nullable MidiReceiver receiver
        ) {
            this.usbDevice = usbDevice;
            this.midiDevice = midiDevice;
            this.input = input;
            this.output = output;
            this.sessionId = sessionId(usbDevice);
            String name = displayName(usbDevice);
            this.displayName = name != null ? name : "USB MIDI";
            if (this.output != null && receiver != null) {
                this.output.connect(receiver);
            }
        }

        boolean isOpen() {
            return midiDevice != null && input != null && output != null;
        }

        boolean sendSysex(byte[] sysex) {
            return AndroidUsbMidiTransport.sendSysex(input, sysex);
        }

        String inferBoardType(@Nullable String boardTypeHint) {
            return AndroidUsbMidiTransport.inferBoardType(usbDevice, boardTypeHint);
        }

        @Override
        public void close() {
            closeQuietly(output);
            closeQuietly(input);
            closeQuietly(midiDevice);
        }
    }

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

    @Nullable
    static UsbDevice findSupportedRuntimeDevice(@Nullable UsbManager usbManager) {
        if (usbManager == null) {
            return null;
        }
        HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (isSupportedRuntimeDevice(device)) {
                return device;
            }
        }
        return null;
    }

    @Nullable
    static MidiDeviceInfo findDeviceInfo(@Nullable MidiManager midiManager, UsbDevice usbDevice) {
        if (midiManager == null) {
            return null;
        }
        for (MidiDeviceInfo info : midiManager.getDevices()) {
            Object prop = info.getProperties().get(MidiDeviceInfo.PROPERTY_USB_DEVICE);
            if (prop instanceof UsbDevice) {
                UsbDevice dev = (UsbDevice) prop;
                if (dev.getVendorId() == usbDevice.getVendorId() && dev.getProductId() == usbDevice.getProductId()) {
                    return info;
                }
            }
        }
        return null;
    }

    static OpenPorts openPorts(MidiDevice device) {
        return new OpenPorts(device.openInputPort(0), device.openOutputPort(0));
    }

    static Connection openConnection(UsbDevice usbDevice, MidiDevice midiDevice, @Nullable MidiReceiver receiver) {
        OpenPorts ports = openPorts(midiDevice);
        return new Connection(usbDevice, midiDevice, ports.input, ports.output, receiver);
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

    private static void closeQuietly(@Nullable AutoCloseable closeable) {
        try {
            if (closeable != null) {
                closeable.close();
            }
        } catch (Exception ignored) {
        }
    }
}
