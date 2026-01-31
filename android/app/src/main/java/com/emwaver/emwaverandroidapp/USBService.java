/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp;

import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.ui.flash.Dfu;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;

public class USBService extends Service implements DeviceConnectionService {

    public static final String ACTION_CONNECT_USB = "com.emwaver.ACTION_CONNECT_USB";
    public static final String ACTION_CONNECT_USB_BOOTLOADER = "com.emwaver.GRANT_USB";

    private static final String TAG = "USBService";

    // STM32 firmware descriptors (stm/emwaver-firmware/USB_DEVICE/App/usbd_desc.c)
    private static final int EMW_USB_VENDOR_ID = 1155;   // 0x0483
    private static final int EMW_USB_PRODUCT_ID = 22336; // 0x5740

    private final IBinder binder = new LocalBinder();

    // DFU/flash (USB control transfers)
    private UsbDeviceConnection finalConnection;

    // USB MIDI transport
    private MidiManager midiManager;
    private HandlerThread midiThread;
    private Handler midiHandler;

    private MidiDevice midiDevice;
    private MidiInputPort midiIn;
    private MidiOutputPort midiOut;

    private final Object midiLock = new Object();

    // SysEx receive accumulator (raw MIDI bytes)
    private final ByteArrayOutputStream sysexBuf = new ByteArrayOutputStream(64);
    private boolean inSysex = false;

    // Buffer bridge methods
    public void storeBulkPkt(byte[] data, long tsMs) {
        NativeBuffer.storeBulkPkt(data, tsMs);
    }

    public void storeBulkPkt(byte[] data) {
        NativeBuffer.storeBulkPkt(data, System.currentTimeMillis());
    }

    public Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
        return NativeBuffer.compressDataBits(rangeStart, rangeEnd, numberBins);
    }

    public void clearBuffer() {
        NativeBuffer.clearBuffer();
    }

    public int getBufferLength() {
        return NativeBuffer.getBufferLength();
    }

    public void loadBuffer(byte[] data) {
        NativeBuffer.loadBuffer(data);
    }

    public byte[] getBuffer() {
        return NativeBuffer.getBuffer();
    }

    private void logTx(byte[] data) {
        if (data == null || data.length == 0) return;
        NativeBuffer.appendTxBytes(data, System.currentTimeMillis());
    }

    private static byte[] makeLanePacket(byte[] data) {
        if (data == null) return null;
        try {
            return NativeBuffer.makePacket64(data);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static boolean isLaneEmpty(byte[] lane) {
        if (lane == null || lane.length == 0) return true;
        for (byte b : lane) {
            if (b != 0) return false;
        }
        return true;
    }

    private void writeFrame(byte[] cmdLane18, byte[] streamLane18) {
        byte[] sysex = UsbMidiSysex.encodeLanes(cmdLane18, streamLane18);
        if (sysex == null) {
            Log.e(TAG, "writeFrame: failed to encode SysEx");
            return;
        }

        synchronized (midiLock) {
            if (midiIn == null) {
                Toast.makeText(this, "No USB device connected", Toast.LENGTH_SHORT).show();
                return;
            }
            try {
                midiIn.send(sysex, 0, sysex.length, 0);

                // Log non-empty lanes (buffer uses 18B packet size)
                if (!isLaneEmpty(cmdLane18)) {
                    logTx(cmdLane18);
                }
                if (!isLaneEmpty(streamLane18)) {
                    logTx(streamLane18);
                }
            } catch (IOException e) {
                Log.e(TAG, "Error writing USB packet", e);
            }
        }
    }

    public void setUsbDeviceConnection(UsbDeviceConnection connection) {
        this.finalConnection = connection;
    }

    public UsbDeviceConnection getUsbDeviceConnection() {
        return finalConnection;
    }

    public UsbManager getUsbManager() {
        return (UsbManager) getSystemService(Context.USB_SERVICE);
    }

    private UsbDevice findUsbMidiDevice() {
        UsbManager manager = getUsbManager();
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == EMW_USB_VENDOR_ID && device.getProductId() == EMW_USB_PRODUCT_ID) {
                return device;
            }
        }
        return null;
    }

    public void checkForConnectedDevices() {
        UsbDevice dev = findUsbMidiDevice();
        if (dev == null) {
            return;
        }

        UsbManager manager = getUsbManager();
        if (!manager.hasPermission(dev)) {
            PendingIntent usbPermissionIntent = PendingIntent.getBroadcast(
                    this,
                    0,
                    new Intent(ACTION_CONNECT_USB).putExtra(UsbManager.EXTRA_DEVICE, dev),
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );
            manager.requestPermission(dev, usbPermissionIntent);
            return;
        }

        connectUsbMidi(dev);
    }

    public boolean checkConnection() {
        synchronized (midiLock) {
            return midiDevice != null && midiIn != null && midiOut != null;
        }
    }

    public class LocalBinder extends Binder {
        public USBService getService() {
            return USBService.this;
        }
    }

    private MidiReceiver rxReceiver = new MidiReceiver() {
        @Override
        public void onSend(byte[] data, int offset, int count, long timestamp) {
            // Data can arrive chunked; reconstruct fixed-size SysEx messages.
            long tsMs = System.currentTimeMillis();
            for (int i = 0; i < count; i++) {
                byte b = data[offset + i];
                if (b == (byte) 0xF0) {
                    sysexBuf.reset();
                    inSysex = true;
                }
                if (!inSysex) {
                    continue;
                }
                sysexBuf.write(b);
                // Hard cap to avoid unbounded growth on malformed streams.
                if (sysexBuf.size() > 128) {
                    sysexBuf.reset();
                    inSysex = false;
                    continue;
                }
                if (b == (byte) 0xF7) {
                    inSysex = false;
                    byte[] sysex = sysexBuf.toByteArray();
                    sysexBuf.reset();

                    byte[] frame = UsbMidiSysex.decodeSysexToFrame(sysex);
                    if (frame == null || frame.length != UsbMidiSysex.FRAME_SIZE) {
                        continue;
                    }

                    byte[] cmdLane = Arrays.copyOfRange(frame, 0, UsbMidiSysex.LANE_SIZE);
                    byte[] streamLane = Arrays.copyOfRange(frame, UsbMidiSysex.LANE_SIZE, UsbMidiSysex.FRAME_SIZE);

                    // Demultiplex into the shared buffer.
                    // Order matters: sendCommand waits for a response packet (status >= 0x80).
                    if (!isLaneEmpty(cmdLane)) {
                        storeBulkPkt(cmdLane, tsMs);
                    }
                    if (!isLaneEmpty(streamLane)) {
                        storeBulkPkt(streamLane, tsMs);
                    }
                }
            }
        }
    };

    private void connectUsbMidi(UsbDevice usbDevice) {
        if (midiManager == null) {
            midiManager = (MidiManager) getSystemService(Context.MIDI_SERVICE);
        }
        if (midiManager == null) {
            Toast.makeText(this, "USB service unavailable", Toast.LENGTH_SHORT).show();
            return;
        }

        MidiDeviceInfo target = null;
        for (MidiDeviceInfo info : midiManager.getDevices()) {
            Object prop = info.getProperties().get(MidiDeviceInfo.PROPERTY_USB_DEVICE);
            if (prop instanceof UsbDevice) {
                UsbDevice dev = (UsbDevice) prop;
                if (dev.getVendorId() == usbDevice.getVendorId() && dev.getProductId() == usbDevice.getProductId()) {
                    target = info;
                    break;
                }
            }
        }

        if (target == null) {
            Toast.makeText(this, "No USB interface found for EMWaver device", Toast.LENGTH_SHORT).show();
            return;
        }

        final MidiDeviceInfo deviceInfo = target;
        midiManager.openDevice(deviceInfo, device -> {
            if (device == null) {
                Log.e(TAG, "Failed to open USB device");
                return;
            }
            synchronized (midiLock) {
                closeMidiLocked();
                midiDevice = device;
                midiIn = midiDevice.openInputPort(0);
                midiOut = midiDevice.openOutputPort(0);
                if (midiOut != null) {
                    midiOut.connect(rxReceiver);
                }
            }
            Toast.makeText(this, "USB Connected!", Toast.LENGTH_SHORT).show();
        }, midiHandler);
    }

    private void closeMidiLocked() {
        try {
            if (midiOut != null) {
                midiOut.close();
            }
        } catch (IOException ignored) {
        }
        try {
            if (midiIn != null) {
                midiIn.close();
            }
        } catch (IOException ignored) {
        }
        try {
            if (midiDevice != null) {
                midiDevice.close();
            }
        } catch (IOException ignored) {
        }
        midiOut = null;
        midiIn = null;
        midiDevice = null;
    }

    @Override
    public void write(byte[] bytes) {
        if (bytes == null) {
            return;
        }
        // Treat generic write as a cmd-lane injection.
        byte[] cmdLane = bytes.length == UsbMidiSysex.LANE_SIZE ? bytes : makeLanePacket(bytes);
        if (cmdLane == null || cmdLane.length != UsbMidiSysex.LANE_SIZE) {
            Log.e(TAG, "write: payload too large for cmd lane (max " + UsbMidiSysex.LANE_SIZE + ")");
            return;
        }
        byte[] streamLane = new byte[UsbMidiSysex.LANE_SIZE];
        writeFrame(cmdLane, streamLane);
    }

    @Override
    public void transmitBuffer() {
        byte[] samplerBytes = getBuffer();
        if (samplerBytes == null || samplerBytes.length == 0) {
            return;
        }

        // Swap out sampler RX while transmitting so BS flow-control packets
        // don't contaminate sampler data stored in the same buffer.
        Object[] saved = NativeBuffer.takeRxState();
        byte[] savedRxBytes = saved != null && saved.length > 0 && saved[0] instanceof byte[] ? (byte[]) saved[0] : new byte[0];
        long[] savedRxTsMs = saved != null && saved.length > 1 && saved[1] instanceof long[] ? (long[]) saved[1] : new long[0];
        long savedRxCounter = 0;
        if (saved != null && saved.length > 2 && saved[2] instanceof Long) {
            savedRxCounter = (Long) saved[2];
        }

        NativeBuffer.loadBuffer(new byte[0]);
        NativeBuffer.setRxCounter(0);

        int nativeBufferSize = samplerBytes.length;
        int[] txProfile = NativeBuffer.txUsbProfile();
        int packetSize = txProfile != null && txProfile.length > 0 ? txProfile[0] : UsbMidiSysex.LANE_SIZE;
        if (packetSize <= 0 || packetSize > UsbMidiSysex.LANE_SIZE) {
            packetSize = UsbMidiSysex.LANE_SIZE;
        }
        long startTime = System.nanoTime();
        final long period = (txProfile != null && txProfile.length > 1 ? txProfile[1] : 5_120_000L);

        for (int i = 0; i < nativeBufferSize; i += packetSize) {
            int end = Math.min(i + packetSize, nativeBufferSize);
            byte[] chunk = Arrays.copyOfRange(samplerBytes, i, end);

            startTime += period;
            int lastStatus = 0;
            while (true) {
                Object[] next = NativeBuffer.nextRxPacket();
                if (next == null || next.length < 1 || !(next[0] instanceof byte[])) {
                    break;
                }
                int status = NativeBuffer.parseBsStatus((byte[]) next[0]);
                if (status >= 0) {
                    lastStatus = status;
                }
            }

            byte[] streamLane = makeLanePacket(chunk);
            if (streamLane != null && streamLane.length == UsbMidiSysex.LANE_SIZE) {
                // Send as stream lane (cmd lane empty)
                byte[] cmdLane = new byte[UsbMidiSysex.LANE_SIZE];
                writeFrame(cmdLane, streamLane);
            }

            startTime = NativeBuffer.txUsbAdjustDeadlineNs(startTime, lastStatus);

            while (System.nanoTime() < startTime) {
                // Busy wait
            }
        }

        // Allow queued BS packets to be delivered into the temporary RX buffer, then discard them.
        try {
            Thread.sleep(50);
        } catch (InterruptedException ignored) {
        }

        // Restore sampler RX snapshot (discarding packets accumulated during transmit).
        NativeBuffer.restoreRxState(savedRxBytes, savedRxTsMs, savedRxCounter);
    }

    @Override
    public byte[] sendCommand(byte[] command, int timeout) {
        if (command == null) {
            return null;
        }

        // Desktop-parity: drop any stale RX packets before sending so the "next packet"
        // consumed via rx_counter belongs to this command's response.
        NativeBuffer.setRxCounter(NativeBuffer.getRxPacketCount());

        // This calls write(), which sends on cmd lane.
        byte[] packet = makeLanePacket(command);
        if (packet == null) {
            Log.e(TAG, "Command too large: " + command.length + " bytes (max " + UsbMidiSysex.LANE_SIZE + ")");
            return null;
        }

        write(packet);

        // Wait for a cmd-lane response packet: response status is >= 0x80.
        long startTime = System.currentTimeMillis();
        while (System.currentTimeMillis() - startTime < timeout) {
            Object[] next = NativeBuffer.nextRxPacket();
            if (next != null && next.length >= 1 && next[0] instanceof byte[]) {
                byte[] pkt = (byte[]) next[0];
                if (pkt.length >= UsbMidiSysex.LANE_SIZE) {
                    int status = pkt[0] & 0xFF;
                    if (status >= 0x80) {
                        return Arrays.copyOf(pkt, UsbMidiSysex.LANE_SIZE);
                    }
                }
                // Not a cmd response (likely stream/BS); keep waiting.
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException ignored) {
            }
        }

        return null;
    }

    @Override
    public void sendPacket(byte[] data) {
        if (data == null) {
            return;
        }
        byte[] packet = makeLanePacket(data);
        if (packet == null) {
            Log.e(TAG, "Packet too large: " + data.length + " bytes (max " + UsbMidiSysex.LANE_SIZE + ")");
            return;
        }
        write(packet);
    }

    // DFU helpers

    public UsbDevice getUsbDevice() {
        UsbManager manager = getUsbManager();
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                return device;
            }
        }
        return null;
    }

    public void connectUSBFlash() {
        UsbManager manager = getUsbManager();
        UsbDevice device = getUsbDevice();
        if (device != null && manager.hasPermission(device)) {
            UsbDeviceConnection connection = manager.openDevice(device);
            setUsbDeviceConnection(connection);
        }
    }

    public boolean hasUsbPermission() {
        UsbManager manager = getUsbManager();
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                return manager.hasPermission(device);
            }
        }
        return false;
    }

    public void requestUsbPermission() {
        UsbManager manager = getUsbManager();
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                if (!manager.hasPermission(device)) {
                    PendingIntent usbPermissionIntent = PendingIntent.getBroadcast(
                            this,
                            0,
                            new Intent(ACTION_CONNECT_USB_BOOTLOADER).putExtra(UsbManager.EXTRA_DEVICE, device),
                            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
                    );
                    manager.requestPermission(device, usbPermissionIntent);
                }
                break;
            }
        }
    }

    public boolean isFlashDeviceConnected() {
        UsbManager manager = getUsbManager();
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();

        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                return true;
            }
        }
        return false;
    }

    // Broadcast receiver for USB permission
    private final BroadcastReceiver usbPermissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_CONNECT_USB.equals(action)) {
                UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (device != null && intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    Log.d(TAG, "USB permission granted for device: " + device.getDeviceName());
                    connectUsbMidi(device);
                } else {
                    Log.d(TAG, "USB permission denied");
                    Toast.makeText(USBService.this, "USB permission denied", Toast.LENGTH_SHORT).show();
                }
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "USB Service onCreate() called");

        midiManager = (MidiManager) getSystemService(Context.MIDI_SERVICE);
        midiThread = new HandlerThread("emw-usb-midi");
        midiThread.start();
        midiHandler = new Handler(midiThread.getLooper());

        // Register USB permission receiver
        IntentFilter filter = new IntentFilter(ACTION_CONNECT_USB);
        registerReceiver(usbPermissionReceiver, filter);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();

        try {
            unregisterReceiver(usbPermissionReceiver);
        } catch (IllegalArgumentException ignored) {
        }

        synchronized (midiLock) {
            closeMidiLocked();
        }

        if (midiThread != null) {
            midiThread.quitSafely();
            midiThread = null;
            midiHandler = null;
        }

        Log.d(TAG, "USB Service destroyed");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public ConnectionType getConnectionType() {
        return checkConnection() ? ConnectionType.USB : ConnectionType.NONE;
    }

    @Override
    public String getConnectionStatus() {
        if (checkConnection()) {
            return "Connected (USB)";
        }
        return "Not connected";
    }

    @Override
    public void disconnect() {
        synchronized (midiLock) {
            closeMidiLocked();
        }
        Log.d(TAG, "USB disconnected");
    }
}
