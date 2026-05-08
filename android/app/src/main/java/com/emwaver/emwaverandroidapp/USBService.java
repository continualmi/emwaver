/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.app.PendingIntent;
import android.app.Service;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
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

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public class USBService extends Service implements DeviceConnectionService {

    public static final String ACTION_CONNECT_USB = "com.emwaver.ACTION_CONNECT_USB";
    public static final String ACTION_CONNECT_USB_BOOTLOADER = "com.emwaver.GRANT_USB";

    private static final String TAG = "USBService";

    private static final int EMW_OP_VERSION = 0x01;
    private static final int EMW_OP_ENTER_DFU = 0x06;
    private static final int EMW_OP_BOARD_GET = 0x09;

    private enum ActiveTransport {
        NONE,
        USB,
        BLE
    }

    private final IBinder binder = new LocalBinder();

    // DFU/flash (USB control transfers)
    private UsbDeviceConnection finalConnection;

    // USB MIDI transport
    private MidiManager midiManager;
    private HandlerThread midiThread;
    private Handler midiHandler;

    private AndroidUsbMidiTransport.Connection usbMidiConnection;

    private final Object midiLock = new Object();
    private final Object bleLock = new Object();
    private final Object bufferSessionLock = new Object();
    private final Map<String, TransportDeviceSession> bufferSessionsByDeviceId = new HashMap<>();
    private TransportDeviceSession activeBufferSession = new DeviceBufferSession();

    // ESP32 BLE transport
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt bleGatt;
    private BluetoothGattCharacteristic bleCommandCharacteristic;
    private volatile boolean bleConnected = false;
    private volatile boolean bleScanning = false;
    private volatile ActiveTransport activeTransport = ActiveTransport.NONE;
    private volatile ActiveDeviceTarget<ActiveTransport> activeDeviceTarget =
            new ActiveDeviceTarget<>("active", ActiveTransport.NONE);

    private volatile String deviceFirmwareVersion = null;
    private volatile String connectedBoardType = null;
    private volatile String connectedBleDeviceLabel = null;

    private TransportDeviceSession activeBufferSession() {
        synchronized (bufferSessionLock) {
            return activeBufferSession;
        }
    }

    private TransportDeviceSession bufferSession(String deviceId) {
        String key = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        synchronized (bufferSessionLock) {
            TransportDeviceSession session = bufferSessionsByDeviceId.get(key);
            if (session == null) {
                session = new DeviceBufferSession(key);
                bufferSessionsByDeviceId.put(key, session);
            }
            return session;
        }
    }

    private void setActiveBufferSession(String deviceId) {
        TransportDeviceSession session = bufferSession(deviceId);
        synchronized (bufferSessionLock) {
            activeBufferSession = session;
            activeBufferSession.clearAll();
        }
    }

    private boolean isActiveDeviceSession(String deviceId) {
        return activeDeviceTarget.matchesDeviceId(deviceId);
    }

    private boolean requireActiveDeviceSession(String deviceId, String operation) {
        if (isActiveDeviceSession(deviceId)) {
            return true;
        }
        Log.w(TAG, operation + ": target device session is not active: " + deviceId);
        return false;
    }

    // Buffer bridge methods
    public void storeBulkPkt(byte[] data, long tsMs) {
        activeBufferSession().storeBulkPkt(data, tsMs);
    }

    public void storeBulkPkt(byte[] data) {
        activeBufferSession().storeBulkPkt(data, System.currentTimeMillis());
    }

    public Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
        return activeBufferSession().compressDataBits(rangeStart, rangeEnd, numberBins);
    }

    @Override
    public String currentScriptDeviceId() {
        return activeDeviceTarget.deviceId;
    }

    private void setActiveDeviceTarget(String deviceId, ActiveTransport transport) {
        ActiveDeviceTarget<ActiveTransport> target = new ActiveDeviceTarget<>(deviceId, transport);
        setActiveBufferSession(target.deviceId);
        activeDeviceTarget = target;
        activeTransport = target.transport;
    }

    private void clearActiveDeviceTarget(ActiveTransport transport) {
        if (activeDeviceTarget.matchesTransport(transport)) {
            activeDeviceTarget = new ActiveDeviceTarget<>("active", ActiveTransport.NONE);
            activeTransport = ActiveTransport.NONE;
        }
    }

    public void clearBuffer() {
        activeBufferSession().clearAll();
    }

    @Override
    public void clearBuffer(String deviceId) {
        bufferSession(deviceId).clearAll();
    }

    public int getBufferLength() {
        return activeBufferSession().getBufferLength();
    }

    @Override
    public int getBufferLength(String deviceId) {
        return bufferSession(deviceId).getBufferLength();
    }

    public void loadBuffer(byte[] data) {
        activeBufferSession().loadBuffer(data);
    }

    @Override
    public void loadBuffer(byte[] data, String deviceId) {
        bufferSession(deviceId).loadBuffer(data);
    }

    public byte[] getBuffer() {
        return activeBufferSession().getBuffer();
    }

    @Override
    public byte[] getBuffer(String deviceId) {
        return bufferSession(deviceId).getBuffer();
    }

    private void logTx(byte[] data) {
        logTx(data, activeBufferSession());
    }

    private void logTx(byte[] data, TransportDeviceSession bufferSession) {
        if (data == null || data.length == 0) return;
        bufferSession.appendTxBytes(data, System.currentTimeMillis());
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

    private void updateSamplerStreamingState(byte[] lane) {
        updateSamplerStreamingState(lane, activeBufferSession());
    }

    private void updateSamplerStreamingState(byte[] lane, TransportDeviceSession bufferSession) {
        bufferSession.updateSamplerStreamingState(lane);
    }

    private void writeFrame(byte[] cmdLane18, byte[] streamLane18) {
        writeFrame(cmdLane18, streamLane18, activeBufferSession());
    }

    private void writeFrame(byte[] cmdLane18, byte[] streamLane18, TransportDeviceSession bufferSession) {
        byte[] sysex = UsbMidiSysex.encodeLanes(cmdLane18, streamLane18);
        if (sysex == null) {
            Log.e(TAG, "writeFrame: failed to encode SysEx");
            return;
        }

        if (activeTransport == ActiveTransport.BLE) {
            writeBleSysex(sysex);
            if (!isLaneEmpty(cmdLane18)) {
                logTx(cmdLane18, bufferSession);
            }
            if (!isLaneEmpty(streamLane18)) {
                logTx(streamLane18, bufferSession);
            }
            return;
        }

        synchronized (midiLock) {
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            if (connection == null || !connection.isOpen()) {
                Toast.makeText(this, "No USB device connected", Toast.LENGTH_SHORT).show();
                return;
            }
            if (connection.sendSysex(sysex)) {
                // Log non-empty lanes (buffer uses 18B packet size)
                if (!isLaneEmpty(cmdLane18)) {
                    logTx(cmdLane18, bufferSession);
                }
                if (!isLaneEmpty(streamLane18)) {
                    logTx(streamLane18, bufferSession);
                }
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
            if (AndroidUsbMidiTransport.isSupportedRuntimeDevice(device)) {
                return device;
            }
        }
        return null;
    }

    public void checkForConnectedDevices() {
        UsbDevice dev = findUsbMidiDevice();
        if (dev == null) {
            startBleScan();
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
        if (bleConnected && bleCommandCharacteristic != null) {
            return true;
        }
        synchronized (midiLock) {
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            return connection != null && connection.isOpen();
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
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            String deviceId = connection != null ? connection.sessionId : "usb:active";
            feedSysexBytes(data, offset, count, bufferSession(deviceId));
        }
    };

    private void feedSysexBytes(byte[] data, int offset, int count) {
        feedSysexBytes(data, offset, count, activeBufferSession());
    }

    private void feedSysexBytes(byte[] data, int offset, int count, TransportDeviceSession bufferSession) {
        if (data == null || count <= 0) {
            return;
        }
        bufferSession.feedSysexBytes(data, offset, count, System.currentTimeMillis());
    }

    private void connectUsbMidi(UsbDevice usbDevice) {
        if (midiManager == null) {
            midiManager = (MidiManager) getSystemService(Context.MIDI_SERVICE);
        }
        if (midiManager == null) {
            Toast.makeText(this, "USB service unavailable", Toast.LENGTH_SHORT).show();
            return;
        }

        MidiDeviceInfo target = AndroidUsbMidiTransport.findDeviceInfo(midiManager, usbDevice);
        if (target == null) {
            Toast.makeText(this, "No USB interface found for EMWaver device", Toast.LENGTH_SHORT).show();
            return;
        }

        midiManager.openDevice(target, device -> {
            if (device == null) {
                Log.e(TAG, "Failed to open USB device");
                return;
            }
            synchronized (midiLock) {
                closeMidiLocked();
                closeBleLocked();
                connectedBleDeviceLabel = null;
                usbMidiConnection = AndroidUsbMidiTransport.openConnection(usbDevice, device);
                if (usbMidiConnection.output != null) {
                    usbMidiConnection.output.connect(rxReceiver);
                }
                setActiveDeviceTarget(usbMidiConnection.sessionId, ActiveTransport.USB);
            }
            Toast.makeText(this, "USB Connected!", Toast.LENGTH_SHORT).show();
            queryFirmwareVersionAsync();
        }, midiHandler);
    }



    private void queryFirmwareVersionAsync() {
        if (midiHandler == null) {
            queryFirmwareVersionOnce();
            return;
        }
        midiHandler.post(this::queryFirmwareVersionOnce);
    }

    private void queryFirmwareVersionOnce() {
        try {
            if (!checkConnection()) {
                deviceFirmwareVersion = null;
                connectedBoardType = null;
                return;
            }
            // EMW_OP_VERSION (0x01). Response: [0x80, major, minor, ...]
            byte[] lane = sendCommand(new byte[]{(byte) EMW_OP_VERSION}, 900);
            if (lane == null || lane.length < 3) {
                deviceFirmwareVersion = null;
            } else if ((lane[0] & 0xFF) != 0x80) {
                deviceFirmwareVersion = null;
            } else {
                int major = lane[1] & 0xFF;
                int minor = lane[2] & 0xFF;
                deviceFirmwareVersion = major + "." + minor;
            }
            String boardTypeHint = queryBoardTypeHint();
            connectedBoardType = activeTransport == ActiveTransport.BLE && boardTypeHint == null
                    ? "esp32s3"
                    : inferConnectedUsbBoardType(boardTypeHint);
        } catch (Throwable t) {
            deviceFirmwareVersion = null;
            connectedBoardType = activeTransport == ActiveTransport.BLE
                    ? "esp32s3"
                    : inferConnectedUsbBoardType(null);
        }
    }

    private String inferConnectedUsbBoardType(@Nullable String boardTypeHint) {
        AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
        return connection != null
                ? connection.inferBoardType(boardTypeHint)
                : AndroidUsbMidiTransport.inferBoardType(null, boardTypeHint);
    }

    @Nullable
    private String queryBoardTypeHint() {
        try {
            byte[] lane = sendCommand(new byte[]{(byte) EMW_OP_BOARD_GET}, 900);
            if (lane == null || lane.length < 2) {
                return null;
            }
            if ((lane[0] & 0xFF) != 0x80) {
                return null;
            }
            int end = 1;
            while (end < lane.length && lane[end] != 0) {
                end++;
            }
            if (end <= 1) {
                return null;
            }
            return new String(lane, 1, end - 1).trim();
        } catch (Throwable ignored) {
            return null;
        }
    }

    public void requestEnterUpdateMode() {
        // Only valid in Run mode.
        try {
            // EMW_OP_ENTER_DFU (0x06)
            sendCommand(new byte[]{(byte) EMW_OP_ENTER_DFU}, 900);
        } catch (Throwable ignored) {
        }
    }

    private void closeMidiLocked() {
        if (usbMidiConnection != null) {
            usbMidiConnection.close();
        }
        usbMidiConnection = null;
        connectedBleDeviceLabel = null;
        clearActiveDeviceTarget(ActiveTransport.USB);
        connectedBoardType = null;
        deviceFirmwareVersion = null;
        activeBufferSession().resetSamplerStreaming();
    }

    private boolean hasBlePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureBleAdapter() {
        if (bluetoothAdapter != null) {
            return;
        }
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager != null) {
            bluetoothAdapter = manager.getAdapter();
        }
    }

    @SuppressLint("MissingPermission")
    private void startBleScan() {
        if (!hasBlePermission()) {
            Log.d(TAG, "BLE scan skipped: Bluetooth permissions missing");
            return;
        }
        ensureBleAdapter();
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Log.d(TAG, "BLE scan skipped: Bluetooth unavailable or disabled");
            return;
        }
        synchronized (midiLock) {
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            if (connection != null && connection.isOpen()) {
                return;
            }
        }
        synchronized (bleLock) {
            if (bleConnected || bleScanning) {
                return;
            }
            bleScanner = bluetoothAdapter.getBluetoothLeScanner();
            if (bleScanner == null) {
                return;
            }
            bleScanning = true;
            bleScanner.startScan(AndroidBleTransport.scanFilters(), AndroidBleTransport.scanSettings(), bleScanCallback);
            Log.d(TAG, "BLE scan started");
        }
    }

    @SuppressLint("MissingPermission")
    private void stopBleScan() {
        synchronized (bleLock) {
            if (bleScanner != null && bleScanning && hasBlePermission()) {
                bleScanner.stopScan(bleScanCallback);
            }
            bleScanning = false;
        }
    }

    @SuppressLint("MissingPermission")
    private void closeBleLocked() {
        stopBleScan();
        if (bleGatt != null) {
            bleGatt.disconnect();
            bleGatt.close();
        }
        bleGatt = null;
        bleCommandCharacteristic = null;
        bleConnected = false;
        connectedBleDeviceLabel = null;
        clearActiveDeviceTarget(ActiveTransport.BLE);
    }

    @SuppressLint("MissingPermission")
    private void writeBleSysex(byte[] sysex) {
        synchronized (bleLock) {
            if (bleGatt == null || bleCommandCharacteristic == null || !bleConnected) {
                Toast.makeText(this, "No BLE device connected", Toast.LENGTH_SHORT).show();
                return;
            }
            AndroidBleTransport.writeSysex(bleGatt, bleCommandCharacteristic, bleConnected, sysex);
        }
    }

    private final ScanCallback bleScanCallback = new ScanCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (result == null || result.getDevice() == null || !hasBlePermission()) {
                return;
            }
            BluetoothDevice device = result.getDevice();
            String name = device.getName();
            if (name == null && result.getScanRecord() != null) {
                name = result.getScanRecord().getDeviceName();
            }
            if (!AndroidBleTransport.matchesAdvertisementName(name)) {
                return;
            }
            stopBleScan();
            synchronized (bleLock) {
                closeBleLocked();
                connectedBleDeviceLabel = name != null && !name.trim().isEmpty()
                        ? name.trim()
                        : device.getAddress();
                bleGatt = AndroidBleTransport.connect(USBService.this, device, bleGattCallback);
            }
            Log.d(TAG, "BLE connecting: " + (name != null ? name : device.getAddress()));
        }
    };

    private final BluetoothGattCallback bleGattCallback = new BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                AndroidBleTransport.discoverServices(gatt);
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                synchronized (bleLock) {
                    if (bleGatt == gatt) {
                        closeBleLocked();
                    }
                }
                startBleScan();
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            AndroidBleTransport.discoverServicesAfterMtu(gatt);
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            BluetoothGattCharacteristic command = AndroidBleTransport.commandCharacteristic(gatt);
            if (command == null) {
                gatt.disconnect();
                return;
            }
            synchronized (bleLock) {
                bleCommandCharacteristic = command;
                bleConnected = true;
                setActiveDeviceTarget(AndroidBleTransport.sessionId(gatt.getDevice()), ActiveTransport.BLE);
            }
            AndroidBleTransport.enableNotifications(gatt);
            connectedBoardType = "esp32s3";
            Toast.makeText(USBService.this, "BLE Connected!", Toast.LENGTH_SHORT).show();
            queryFirmwareVersionAsync();
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (characteristic != null && AndroidBleTransport.NOTIFY_UUID.equals(characteristic.getUuid())) {
                byte[] value = characteristic.getValue();
                if (value != null) {
                    feedSysexBytes(value, 0, value.length, bufferSession(AndroidBleTransport.sessionId(gatt.getDevice())));
                }
            }
        }
    };

    @Override
    public void write(byte[] bytes) {
        write(bytes, activeBufferSession().deviceId());
    }

    @Override
    public void write(byte[] bytes, String deviceId) {
        if (bytes == null) {
            return;
        }
        if (!requireActiveDeviceSession(deviceId, "write")) {
            return;
        }

        TransportDeviceSession bufferSession = bufferSession(deviceId);
        updateSamplerStreamingState(bytes, bufferSession);

        // Treat generic write as a cmd-lane injection.
        byte[] cmdLane = bytes.length == UsbMidiSysex.LANE_SIZE ? bytes : makeLanePacket(bytes);
        if (cmdLane == null || cmdLane.length != UsbMidiSysex.LANE_SIZE) {
            Log.e(TAG, "write: payload too large for cmd lane (max " + UsbMidiSysex.LANE_SIZE + ")");
            return;
        }
        byte[] streamLane = new byte[UsbMidiSysex.LANE_SIZE];
        writeFrame(cmdLane, streamLane, bufferSession);
    }

    @Override
    public void transmitBuffer() {
        transmitBuffer(activeBufferSession().deviceId());
    }

    @Override
    public void transmitBuffer(String deviceId) {
        if (!requireActiveDeviceSession(deviceId, "transmitBuffer")) {
            return;
        }
        TransportDeviceSession bufferSession = bufferSession(deviceId);
        byte[] samplerBytes = bufferSession.getBuffer();
        if (samplerBytes == null || samplerBytes.length == 0) {
            return;
        }

        // Swap out sampler RX while transmitting so BS flow-control packets
        // don't contaminate sampler data stored in the same buffer.
        Object[] saved = bufferSession.takeRxState();
        byte[] savedRxBytes = saved != null && saved.length > 0 && saved[0] instanceof byte[] ? (byte[]) saved[0] : new byte[0];
        long[] savedRxTsMs = saved != null && saved.length > 1 && saved[1] instanceof long[] ? (long[]) saved[1] : new long[0];
        long savedRxCounter = 0;
        if (saved != null && saved.length > 2 && saved[2] instanceof Long) {
            savedRxCounter = (Long) saved[2];
        }

        bufferSession.loadBuffer(new byte[0]);
        bufferSession.setRxCounter(0);

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
                Object[] next = bufferSession.nextRxPacket();
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
                writeFrame(cmdLane, streamLane, bufferSession);
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
        bufferSession.restoreRxState(savedRxBytes, savedRxTsMs, savedRxCounter);
    }

    @Override
    public byte[] sendCommand(byte[] command, int timeout) {
        return sendCommand(command, timeout, activeBufferSession().deviceId());
    }

    @Override
    public byte[] sendCommand(byte[] command, int timeout, String deviceId) {
        if (command == null) {
            return null;
        }
        if (!requireActiveDeviceSession(deviceId, "sendCommand")) {
            return null;
        }

        TransportDeviceSession bufferSession = bufferSession(deviceId);
        bufferSession.prepareCommandResponseWait();

        // This calls write(), which sends on cmd lane.
        byte[] packet = makeLanePacket(command);
        if (packet == null) {
            Log.e(TAG, "Command too large: " + command.length + " bytes (max " + UsbMidiSysex.LANE_SIZE + ")");
            return null;
        }

        write(packet, deviceId);

        return bufferSession.awaitCommandResponse(timeout);
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

    public String getDeviceFirmwareVersion() { return deviceFirmwareVersion; }

    public String getConnectedBoardType() { return connectedBoardType; }

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
        synchronized (bleLock) {
            closeBleLocked();
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
        if (!checkConnection()) {
            return ConnectionType.NONE;
        }
        return activeTransport == ActiveTransport.BLE ? ConnectionType.BLE : ConnectionType.USB;
    }

    @Override
    public String getConnectionStatus() {
        if (checkConnection()) {
            if (activeTransport == ActiveTransport.BLE) {
                String label = connectedBleDeviceLabel;
                return label == null || label.trim().isEmpty()
                        ? "Connected (BLE)"
                        : "Connected (BLE: " + label.trim() + ")";
            }
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            String label = connection != null ? connection.displayName : null;
            return label == null || label.trim().isEmpty()
                    ? "Connected (USB)"
                    : "Connected (USB: " + label.trim() + ")";
        }
        return "Not connected";
    }

    @Override
    public void disconnect() {
        synchronized (midiLock) {
            closeMidiLocked();
        }
        synchronized (bleLock) {
            closeBleLocked();
        }
        Log.d(TAG, "Device disconnected");
    }
}
