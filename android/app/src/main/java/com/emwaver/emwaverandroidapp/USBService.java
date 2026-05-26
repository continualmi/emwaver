/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.Manifest;
import android.app.PendingIntent;
import android.app.Service;
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
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.ui.flash.Dfu;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;

public class USBService extends Service implements DeviceConnectionService {

    public static final String ACTION_CONNECT_USB = "com.emwaver.ACTION_CONNECT_USB";
    public static final String ACTION_CONNECT_USB_BOOTLOADER = "com.emwaver.GRANT_USB";

    private static final String TAG = "USBService";

    private static final int EMW_OP_VERSION = 0x01;
    private static final int EMW_OP_ENTER_DFU = 0x06;
    private static final int EMW_OP_BOARD_GET = 0x09;

    // Transport session
    private static final byte EMW_OP_TRANSPORT_SESSION = 0x0B;
    private static final byte EMW_TRANSPORT_SESSION_CONNECT = 0x01;
    private static final byte EMW_TRANSPORT_SESSION_DISCONNECT = 0x02;
    private static final byte EMW_TRANSPORT_SESSION_HEARTBEAT = 0x03;
    private static final byte EMW_COMMAND_SOURCE_USB = 0x01;
    private static final byte EMW_COMMAND_SOURCE_BLE = 0x02;
    private static final byte EMW_COMMAND_SOURCE_WIFI = 0x03;
    private static final int TRANSPORT_SESSION_HEARTBEAT_MS = 2000;

    private final IBinder binder = new LocalBinder();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // DFU/flash (USB control transfers)
    private UsbDeviceConnection finalConnection;

    // USB MIDI transport
    private MidiManager midiManager;
    private HandlerThread midiThread;
    private Handler midiHandler;

    private AndroidUsbMidiTransport.Connection usbMidiConnection;

    private final Object midiLock = new Object();
    private final TransportDeviceSessionRegistry bufferSessions = new TransportDeviceSessionRegistry();
    private final AndroidBleProtocol bleProtocol = new AndroidBleProtocol(this);
    private final AndroidWiFiProtocol wifiProtocol = new AndroidWiFiProtocol(this);
    private volatile ActiveTransport activeTransport = ActiveTransport.NONE;
    private final TransportDeviceConnectionState<ActiveTransport> activeConnectionState =
            new TransportDeviceConnectionState<>(ActiveTransport.NONE);

    private final Object commandLock = new Object();
    private volatile String deviceFirmwareVersion = null;
    private volatile String connectedBoardType = null;

    // Transport session state
    private HandlerThread sessionThread;
    private Handler sessionHandler;
    private final java.util.Map<String, Runnable> heartbeatRunnables = new java.util.HashMap<>();

    private TransportDeviceSession activeBufferSession() {
        return bufferSessions.active();
    }

    private TransportDeviceSession bufferSession(String deviceId) {
        return bufferSessions.session(deviceId);
    }

    private void setActiveBufferSession(String deviceId, boolean resetSession) {
        bufferSessions.select(deviceId, resetSession);
    }

    private boolean isActiveDeviceSession(String deviceId) {
        return activeConnectionState.matchesDeviceId(deviceId);
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
        return activeConnectionState.currentScriptDeviceId();
    }

    TransportDeviceSession setActiveDeviceTarget(String deviceId, ActiveTransport transport) {
        ActiveDeviceTarget<ActiveTransport> target = activeConnectionState.setTarget(deviceId, transport);
        TransportDeviceSession session = bufferSessions.select(target.deviceId, true);
        activeTransport = target.transport;
        return session;
    }

    void clearActiveDeviceTarget(ActiveTransport transport) {
        if (activeConnectionState.matchesTransport(transport)) {
            activeConnectionState.clear();
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

    void showToast(String message) {
        mainHandler.post(() -> Toast.makeText(this, message, Toast.LENGTH_SHORT).show());
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
            bleProtocol.writeSysex(sysex);
            if (!isLaneEmpty(cmdLane18)) {
                logTx(cmdLane18, bufferSession);
            }
            if (!isLaneEmpty(streamLane18)) {
                logTx(streamLane18, bufferSession);
            }
            return;
        }

        if (activeTransport == ActiveTransport.WIFI) {
            wifiProtocol.writeSysex(sysex);
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
        return AndroidUsbMidiTransport.findSupportedRuntimeDevice(getUsbManager());
    }

    public void checkForConnectedDevices() {
        UsbDevice dev = findUsbMidiDevice();
        if (dev == null) {
            bleProtocol.startScan();
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
        if (wifiProtocol.hasOpenConnection()) {
            return true;
        }
        if (bleProtocol.hasOpenConnection()) {
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

    void feedSysexBytes(byte[] data, int offset, int count, TransportDeviceSession bufferSession) {
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
            bleProtocol.close();
            wifiProtocol.close();
            synchronized (midiLock) {
                closeMidiLocked();
                TransportDeviceSession session = setActiveDeviceTarget(
                        AndroidUsbMidiTransport.sessionId(usbDevice),
                        ActiveTransport.USB);
                usbMidiConnection = AndroidUsbMidiTransport.openConnection(usbDevice, device, rxReceiver, session);
                setActiveConnection(usbMidiConnection);
            }
            Toast.makeText(this, "USB Connected!", Toast.LENGTH_SHORT).show();
            queryFirmwareVersionAsync();
        }, midiHandler);
    }



    void queryFirmwareVersionAsync() {
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
            connectedBoardType = inferConnectedBoardType(boardTypeHint);
        } catch (Throwable t) {
            deviceFirmwareVersion = null;
            connectedBoardType = inferConnectedBoardType(null);
        }
    }

    private String inferConnectedBoardType(@Nullable String boardTypeHint) {
        if (activeTransport == ActiveTransport.BLE && boardTypeHint == null) {
            return AndroidBleTransport.boardType();
        }
        if (activeTransport == ActiveTransport.WIFI && boardTypeHint == null) {
            return "esp32";
        }
        return inferConnectedUsbBoardType(boardTypeHint);
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
        clearActiveDeviceTarget(ActiveTransport.USB);
        connectedBoardType = null;
        deviceFirmwareVersion = null;
        activeBufferSession().resetSamplerStreaming();
    }

    boolean hasBlePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
                    && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    boolean hasUsbMidiConnection() {
        synchronized (midiLock) {
            AndroidUsbMidiTransport.Connection connection = usbMidiConnection;
            return connection != null && connection.isOpen();
        }
    }

    void closeUsbTransport() {
        synchronized (midiLock) {
            closeMidiLocked();
        }
    }

    void closeBleTransport() {
        bleProtocol.close();
    }

    void closeWiFiTransport() {
        wifiProtocol.close();
    }

    public void connectWiFi(String host, int port) {
        wifiProtocol.connect(host, port);
    }

    public void startWiFiDiscovery(AndroidWiFiDiscovery.Listener listener) {
        wifiProtocol.startDiscovery(listener);
    }

    public void stopWiFiDiscovery(boolean clearDevices) {
        wifiProtocol.stopDiscovery(clearDevices);
    }

    public String provisionWiFi(String ssid, String password) {
        List<byte[]> commands = AndroidWiFiTransport.provisioningCommands(ssid, password);
        if (commands == null) {
            return "Wi-Fi SSID is required and setup values must fit the ESP32 limits.";
        }
        if (!checkConnection()) {
            return "Connect a Wi-Fi-capable ESP32 board before provisioning Wi-Fi.";
        }

        for (byte[] command : commands) {
            if (!AndroidWiFiTransport.isOkResponse(sendCommand(command, 2000))) {
                return "Wi-Fi setup was rejected by the device.";
            }
        }

        return "Wi-Fi setup sent. The ESP32 board will join the network and advertise itself with mDNS.";
    }

    public String clearWiFiProvisioning() {
        if (!checkConnection()) {
            return "Connect a Wi-Fi-capable ESP32 board before clearing Wi-Fi setup.";
        }
        if (!AndroidWiFiTransport.isOkResponse(sendCommand(AndroidWiFiTransport.clearProvisioningCommand(), 2000))) {
            return "Wi-Fi setup clear was rejected by the device.";
        }
        return "Wi-Fi setup cleared. Provision the ESP32 board again before using Wi-Fi control.";
    }

    public String refreshWiFiProvisioningStatus() {
        if (!checkConnection()) {
            return "Connect a Wi-Fi-capable ESP32 board before checking Wi-Fi status.";
        }
        String message = AndroidWiFiTransport.statusMessage(sendCommand(AndroidWiFiTransport.statusCommand(), 2000));
        return message != null ? message : "Wi-Fi status request was rejected by the device.";
    }

    void setActiveConnection(TransportDeviceConnection connection) {
        activeConnectionState.setConnection(connection);
    }

    void setConnectedBoardType(String boardType) {
        connectedBoardType = boardType;
    }

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

        synchronized (commandLock) {
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

        sessionThread = new HandlerThread("emw-transport-session");
        sessionThread.start();
        sessionHandler = new Handler(sessionThread.getLooper());

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
        bleProtocol.close();
        wifiProtocol.close();

        stopAllHeartbeats();

        if (midiThread != null) {
            midiThread.quitSafely();
            midiThread = null;
            midiHandler = null;
        }

        if (sessionThread != null) {
            sessionThread.quitSafely();
            sessionThread = null;
            sessionHandler = null;
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
        if (activeTransport == ActiveTransport.BLE) {
            return ConnectionType.BLE;
        }
        if (activeTransport == ActiveTransport.WIFI) {
            return ConnectionType.WIFI;
        }
        return ConnectionType.USB;
    }

    @Override
    public String getConnectionStatus() {
        if (checkConnection()) {
            TransportDeviceConnection activeConnection = activeConnectionState.connection();
            if (activeConnection != null) {
                String label = activeConnection.displayName();
                if (activeTransport == ActiveTransport.BLE) {
                    return label == null || label.trim().isEmpty()
                            ? "Connected (BLE)"
                            : "Connected (BLE: " + label.trim() + ")";
                }
                if (activeTransport == ActiveTransport.WIFI) {
                    return label == null || label.trim().isEmpty()
                            ? "Connected (Wi-Fi)"
                            : "Connected (" + label.trim() + ")";
                }
                return label == null || label.trim().isEmpty()
                        ? "Connected (USB)"
                        : "Connected (USB: " + label.trim() + ")";
            }
            if (activeTransport == ActiveTransport.BLE) {
                String label = bleProtocol.connectedLabel();
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
        endTransportSession();
        synchronized (midiLock) {
            closeMidiLocked();
        }
        bleProtocol.close();
        wifiProtocol.close();
        Log.d(TAG, "Device disconnected");
    }

    // ── Transport session ──────────────────────────────────────────

    @Override
    public boolean beginTransportSession(String deviceId) {
        if (!checkConnection()) {
            Log.w(TAG, "beginTransportSession: device not connected");
            return false;
        }
        if (!requiresTransportSession()) {
            return true;
        }
        byte source = transportSessionSource();
        byte[] cmd = {EMW_OP_TRANSPORT_SESSION, EMW_TRANSPORT_SESSION_CONNECT, source};
        byte[] response = sendCommand(cmd, 1500, deviceId);
        if (response == null || response.length == 0 || response[0] != (byte) 0x80) {
            Log.w(TAG, "beginTransportSession: CONNECT rejected or timed out");
            return false;
        }
        startHeartbeat(deviceId, source);
        Log.d(TAG, "Transport session started (source=" + (source & 0xFF) + ")");
        return true;
    }

    @Override
    public void endTransportSession(String deviceId) {
        stopHeartbeat(deviceId);
        if (!checkConnection()) {
            return;
        }
        if (!requiresTransportSession()) {
            return;
        }
        byte source = transportSessionSource();
        byte[] cmd = {EMW_OP_TRANSPORT_SESSION, EMW_TRANSPORT_SESSION_DISCONNECT, source};
        sendCommand(cmd, 1000, deviceId);
        Log.d(TAG, "Transport session ended");
    }

    private void endTransportSession() {
        String deviceId = activeBufferSession().deviceId();
        endTransportSession(deviceId);
    }

    @Override
    public boolean requiresTransportSession() {
        if (activeTransport == ActiveTransport.BLE || activeTransport == ActiveTransport.WIFI) {
            return true;
        }
        String boardType = connectedBoardType;
        return boardType != null && boardType.toLowerCase().startsWith("esp32");
    }

    private byte transportSessionSource() {
        if (activeTransport == ActiveTransport.BLE) return EMW_COMMAND_SOURCE_BLE;
        if (activeTransport == ActiveTransport.WIFI) return EMW_COMMAND_SOURCE_WIFI;
        return EMW_COMMAND_SOURCE_USB;
    }

    private void startHeartbeat(String deviceId, byte source) {
        if (sessionHandler == null) {
            Log.w(TAG, "startHeartbeat: session handler not ready");
            return;
        }
        stopHeartbeat(deviceId);
        String key = deviceId != null ? deviceId : "active";
        Runnable runnable = new Runnable() {
            @Override
            public void run() {
                if (!checkConnection() || activeBufferSession().deviceId() == null
                        || !activeBufferSession().deviceId().equals(deviceId)) {
                    stopHeartbeat(deviceId);
                    return;
                }
                sendHeartbeat(deviceId, source);
                if (sessionHandler != null) {
                    sessionHandler.postDelayed(this, TRANSPORT_SESSION_HEARTBEAT_MS);
                }
            }
        };
        heartbeatRunnables.put(key, runnable);
        sessionHandler.postDelayed(runnable, TRANSPORT_SESSION_HEARTBEAT_MS);
    }

    private void sendHeartbeat(String deviceId, byte source) {
        byte[] cmd = {EMW_OP_TRANSPORT_SESSION, EMW_TRANSPORT_SESSION_HEARTBEAT, source};
        byte[] response;
        synchronized (commandLock) {
            if (!requireActiveDeviceSession(deviceId, "heartbeat")) {
                return;
            }
            TransportDeviceSession bufferSession = bufferSession(deviceId);
            bufferSession.prepareCommandResponseWait();
            byte[] packet = makeLanePacket(cmd);
            if (packet == null) return;
            write(packet, deviceId);
            response = bufferSession.awaitCommandResponse(1000);
        }
        if (response == null || response.length == 0 || response[0] != (byte) 0x80) {
            Log.w(TAG, "Heartbeat failed — session expired");
            markTransportSessionLost(deviceId);
        }
    }

    private void markTransportSessionLost(String deviceId) {
        stopHeartbeat(deviceId);
        ActiveTransport transport = activeTransport;
        if (transport == ActiveTransport.USB) {
            synchronized (midiLock) {
                closeMidiLocked();
            }
        } else if (transport == ActiveTransport.BLE) {
            bleProtocol.close();
        } else if (transport == ActiveTransport.WIFI) {
            wifiProtocol.close();
        } else {
            activeConnectionState.clear();
            activeTransport = ActiveTransport.NONE;
        }
        showToast("Transport session lost. Reconnect the selected device.");
    }

    private void stopHeartbeat(String deviceId) {
        String key = deviceId != null ? deviceId : "active";
        Runnable runnable = heartbeatRunnables.remove(key);
        if (runnable != null && sessionHandler != null) {
            sessionHandler.removeCallbacks(runnable);
        }
    }

    private void stopAllHeartbeats() {
        if (sessionHandler != null) {
            for (Runnable runnable : heartbeatRunnables.values()) {
                sessionHandler.removeCallbacks(runnable);
            }
        }
        heartbeatRunnables.clear();
    }
}
