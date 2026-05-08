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
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.UUID;

public class USBService extends Service implements DeviceConnectionService {

    public static final String ACTION_CONNECT_USB = "com.emwaver.ACTION_CONNECT_USB";
    public static final String ACTION_CONNECT_USB_BOOTLOADER = "com.emwaver.GRANT_USB";

    private static final String TAG = "USBService";

    // STM32 firmware descriptors (stm/emwaver-firmware/USB_DEVICE/App/usbd_desc.c)
    private static final int EMW_USB_VENDOR_ID = 1155;   // 0x0483
    private static final int EMW_USB_PRODUCT_ID = 22336; // 0x5740
    private static final int EMW_OP_VERSION = 0x01;
    private static final int EMW_OP_ENTER_DFU = 0x06;
    private static final int EMW_OP_BOARD_GET = 0x09;

    // Sampler opcodes.
    private static final int EMW_OP_SAMPLE = 0x60;
    private static final int EMW_SAMPLE_START = 0x00;
    private static final int EMW_SAMPLE_STOP = 0x01;

    private static final UUID EMW_BLE_SERVICE_UUID = UUID.fromString("45C7158E-0C3B-4E90-A847-452A15B14191");
    private static final UUID EMW_BLE_COMMAND_UUID = UUID.fromString("46C7158E-0C3B-4E90-A847-452A15B14191");
    private static final UUID EMW_BLE_NOTIFY_UUID = UUID.fromString("47C7158E-0C3B-4E90-A847-452A15B14191");
    private static final UUID CLIENT_CHARACTERISTIC_CONFIG_UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB");

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

    private MidiDevice midiDevice;
    private MidiInputPort midiIn;
    private MidiOutputPort midiOut;

    private final Object midiLock = new Object();
    private final Object bleLock = new Object();
    private final Object bufferSessionLock = new Object();
    private final Map<String, DeviceBufferSession> bufferSessionsByDeviceId = new HashMap<>();
    private DeviceBufferSession activeBufferSession = new DeviceBufferSession();

    // ESP32 BLE transport
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bleScanner;
    private BluetoothGatt bleGatt;
    private BluetoothGattCharacteristic bleCommandCharacteristic;
    private volatile boolean bleConnected = false;
    private volatile boolean bleScanning = false;
    private volatile ActiveTransport activeTransport = ActiveTransport.NONE;

    // Keep all-zero stream lanes while sampler stream mode is active.
    private volatile boolean isSamplerStreamingActive = false;

    private volatile String deviceFirmwareVersion = null;
    private volatile String connectedBoardType = null;
    private volatile UsbDevice connectedMidiUsbDevice = null;

    // SysEx receive accumulator (raw MIDI bytes)
    private final ByteArrayOutputStream sysexBuf = new ByteArrayOutputStream(64);
    private boolean inSysex = false;

    private DeviceBufferSession activeBufferSession() {
        synchronized (bufferSessionLock) {
            return activeBufferSession;
        }
    }

    private void setActiveBufferSession(String deviceId) {
        String key = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
        synchronized (bufferSessionLock) {
            DeviceBufferSession session = bufferSessionsByDeviceId.get(key);
            if (session == null) {
                session = new DeviceBufferSession();
                bufferSessionsByDeviceId.put(key, session);
            }
            activeBufferSession = session;
            activeBufferSession.clearAll();
        }
    }

    private static String usbDeviceSessionId(UsbDevice device) {
        if (device == null) return "usb:active";
        return "usb:" + device.getVendorId() + ":" + device.getProductId() + ":" + device.getDeviceName();
    }

    private static String bleDeviceSessionId(BluetoothDevice device) {
        if (device == null) return "ble:active";
        return "ble:" + device.getAddress();
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

    public void clearBuffer() {
        activeBufferSession().clearAll();
    }

    public int getBufferLength() {
        return activeBufferSession().getBufferLength();
    }

    public void loadBuffer(byte[] data) {
        activeBufferSession().loadBuffer(data);
    }

    public byte[] getBuffer() {
        return activeBufferSession().getBuffer();
    }

    private void logTx(byte[] data) {
        if (data == null || data.length == 0) return;
        activeBufferSession().appendTxBytes(data, System.currentTimeMillis());
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
        if (lane == null || lane.length < 2) {
            return;
        }
        int opcode = lane[0] & 0xFF;
        if (opcode != EMW_OP_SAMPLE) {
            return;
        }
        int sub = lane[1] & 0xFF;
        if (sub == EMW_SAMPLE_START) {
            isSamplerStreamingActive = true;
        } else if (sub == EMW_SAMPLE_STOP) {
            isSamplerStreamingActive = false;
        }
    }

    private void writeFrame(byte[] cmdLane18, byte[] streamLane18) {
        byte[] sysex = UsbMidiSysex.encodeLanes(cmdLane18, streamLane18);
        if (sysex == null) {
            Log.e(TAG, "writeFrame: failed to encode SysEx");
            return;
        }

        if (activeTransport == ActiveTransport.BLE) {
            writeBleSysex(sysex);
            if (!isLaneEmpty(cmdLane18)) {
                logTx(cmdLane18);
            }
            if (!isLaneEmpty(streamLane18)) {
                logTx(streamLane18);
            }
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
            if (isSupportedEmwaverRuntimeDevice(device)) {
                return device;
            }
        }
        return null;
    }

    private boolean isSupportedEmwaverRuntimeDevice(@Nullable UsbDevice device) {
        if (device == null) {
            return false;
        }
        if (device.getVendorId() == EMW_USB_VENDOR_ID && device.getProductId() == EMW_USB_PRODUCT_ID) {
            return true;
        }

        String manufacturer = lower(device.getManufacturerName());
        String product = lower(device.getProductName());

        if (product.contains("emwaver")) {
            return true;
        }
        if (manufacturer.contains("emwaver")) {
            return true;
        }
        if ((manufacturer.contains("espressif") || product.contains("esp32") || product.contains("esp32-s3") || product.contains("s3"))
                && usbDeviceLooksLikeMidi(device)) {
            return true;
        }
        return false;
    }

    private boolean usbDeviceLooksLikeMidi(@Nullable UsbDevice device) {
        if (device == null) {
            return false;
        }
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            android.hardware.usb.UsbInterface iface = device.getInterface(i);
            if (iface == null) {
                continue;
            }
            if (iface.getInterfaceClass() == 1 && iface.getInterfaceSubclass() == 3) {
                return true;
            }
        }
        return false;
    }

    private String lower(@Nullable String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.US);
    }

    private String inferBoardType(@Nullable UsbDevice device, @Nullable String boardTypeHint) {
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
            feedSysexBytes(data, offset, count);
        }
    };

    private void feedSysexBytes(byte[] data, int offset, int count) {
        if (data == null || count <= 0) {
            return;
        }
        long tsMs = System.currentTimeMillis();
        synchronized (sysexBuf) {
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
                    if (!isLaneEmpty(streamLane) || isSamplerStreamingActive) {
                        storeBulkPkt(streamLane, tsMs);
                    }
                }
            }
        }
    }

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
                closeBleLocked();
                midiDevice = device;
                connectedMidiUsbDevice = usbDevice;
                midiIn = midiDevice.openInputPort(0);
                midiOut = midiDevice.openOutputPort(0);
                if (midiOut != null) {
                    midiOut.connect(rxReceiver);
                }
                setActiveBufferSession(usbDeviceSessionId(usbDevice));
                activeTransport = ActiveTransport.USB;
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
                    : inferBoardType(connectedMidiUsbDevice, boardTypeHint);
        } catch (Throwable t) {
            deviceFirmwareVersion = null;
            connectedBoardType = activeTransport == ActiveTransport.BLE
                    ? "esp32s3"
                    : inferBoardType(connectedMidiUsbDevice, null);
        }
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
        connectedMidiUsbDevice = null;
        if (activeTransport == ActiveTransport.USB) {
            activeTransport = ActiveTransport.NONE;
        }
        connectedBoardType = null;
        deviceFirmwareVersion = null;
        isSamplerStreamingActive = false;
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
            if (midiDevice != null && midiIn != null && midiOut != null) {
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
            ScanFilter filter = new ScanFilter.Builder()
                    .setServiceUuid(new android.os.ParcelUuid(EMW_BLE_SERVICE_UUID))
                    .build();
            ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .build();
            bleScanning = true;
            bleScanner.startScan(Collections.singletonList(filter), settings, bleScanCallback);
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
        if (activeTransport == ActiveTransport.BLE) {
            activeTransport = ActiveTransport.NONE;
        }
    }

    @SuppressLint("MissingPermission")
    private void writeBleSysex(byte[] sysex) {
        synchronized (bleLock) {
            if (bleGatt == null || bleCommandCharacteristic == null || !bleConnected) {
                Toast.makeText(this, "No BLE device connected", Toast.LENGTH_SHORT).show();
                return;
            }
            bleCommandCharacteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            bleCommandCharacteristic.setValue(sysex);
            if (!bleGatt.writeCharacteristic(bleCommandCharacteristic)) {
                Log.e(TAG, "BLE writeCharacteristic returned false");
            }
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
            if (name != null && !name.toLowerCase(Locale.US).contains("emwaver")) {
                return;
            }
            stopBleScan();
            synchronized (bleLock) {
                closeBleLocked();
                bleGatt = device.connectGatt(USBService.this, false, bleGattCallback, BluetoothDevice.TRANSPORT_LE);
            }
            Log.d(TAG, "BLE connecting: " + (name != null ? name : device.getAddress()));
        }
    };

    private final BluetoothGattCallback bleGattCallback = new BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (!gatt.requestMtu(64)) {
                    gatt.discoverServices();
                }
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
            gatt.discoverServices();
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            BluetoothGattService service = gatt.getService(EMW_BLE_SERVICE_UUID);
            if (service == null) {
                Log.e(TAG, "BLE EMWaver service missing");
                gatt.disconnect();
                return;
            }
            BluetoothGattCharacteristic command = service.getCharacteristic(EMW_BLE_COMMAND_UUID);
            BluetoothGattCharacteristic notify = service.getCharacteristic(EMW_BLE_NOTIFY_UUID);
            if (command == null) {
                Log.e(TAG, "BLE command characteristic missing");
                gatt.disconnect();
                return;
            }
            synchronized (bleLock) {
                bleCommandCharacteristic = command;
                bleConnected = true;
                setActiveBufferSession(bleDeviceSessionId(gatt.getDevice()));
                activeTransport = ActiveTransport.BLE;
            }
            if (notify != null) {
                gatt.setCharacteristicNotification(notify, true);
                BluetoothGattDescriptor cccd = notify.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG_UUID);
                if (cccd != null) {
                    cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    gatt.writeDescriptor(cccd);
                }
            }
            connectedBoardType = "esp32s3";
            Toast.makeText(USBService.this, "BLE Connected!", Toast.LENGTH_SHORT).show();
            queryFirmwareVersionAsync();
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            if (characteristic != null && EMW_BLE_NOTIFY_UUID.equals(characteristic.getUuid())) {
                byte[] value = characteristic.getValue();
                if (value != null) {
                    feedSysexBytes(value, 0, value.length);
                }
            }
        }
    };

    @Override
    public void write(byte[] bytes) {
        if (bytes == null) {
            return;
        }

        updateSamplerStreamingState(bytes);

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
        DeviceBufferSession bufferSession = activeBufferSession();
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
        bufferSession.restoreRxState(savedRxBytes, savedRxTsMs, savedRxCounter);
    }

    @Override
    public byte[] sendCommand(byte[] command, int timeout) {
        if (command == null) {
            return null;
        }

        // Desktop-parity: drop any stale RX packets before sending so the "next packet"
        // consumed via rx_counter belongs to this command's response.
        DeviceBufferSession bufferSession = activeBufferSession();
        bufferSession.setRxCounter(bufferSession.getRxPacketCount());

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
            Object[] next = bufferSession.nextRxPacket();
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
            return activeTransport == ActiveTransport.BLE ? "Connected (BLE)" : "Connected (USB)";
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
