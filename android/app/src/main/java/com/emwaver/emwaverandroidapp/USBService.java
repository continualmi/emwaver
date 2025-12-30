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
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.ui.flash.Dfu;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;

import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;

public class USBService extends Service implements DeviceConnectionService, SerialInputOutputManager.Listener {

    public static final String ACTION_CONNECT_USB = "com.emwaver.ACTION_CONNECT_USB";
    public static final String ACTION_CONNECT_USB_BOOTLOADER = "com.emwaver.GRANT_USB";
    private static final String TAG = "USBService";
    
    private SerialInputOutputManager ioManager;
    public UsbSerialPort finalPort = null;
    private final IBinder binder = new LocalBinder();
    private UsbDeviceConnection finalConnection;

    // Buffer bridge methods
    public void storeBulkPkt(byte[] data, long tsMs) {
        NativeBuffer.storeBulkPkt(data, tsMs);
    }

    public void storeBulkPkt(byte[] data) {
        NativeBuffer.storeBulkPkt(data, System.currentTimeMillis());
    }

    public byte[] getCommand() {
        return NativeBuffer.getCommand();
    }

    public Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
        return NativeBuffer.compressDataBits(rangeStart, rangeEnd, numberBins);
    }

    public int getStatusNumber() {
        return NativeBuffer.getStatusNumber();
    }

    public void clearCommandBuffer() {
        NativeBuffer.clearCommandBuffer();
    }

    public void setCaptureMode(boolean enabled) {
        NativeBuffer.setCaptureMode(enabled);
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

    public void invertBuffer() {
        NativeBuffer.invertBuffer();
    }

    public void setCaptureInvert(boolean enabled) {
        NativeBuffer.setCaptureInvert(enabled);
    }

    private void logTx(byte[] data) {
        if (data == null || data.length == 0) return;
        NativeBuffer.appendTxBytes(data, System.currentTimeMillis());
    }

    private long lastPacketReceivedTime = 0;

    public void setUsbDeviceConnection(UsbDeviceConnection connection) {
        this.finalConnection = connection;
    }

    public UsbDeviceConnection getUsbDeviceConnection() {
        return finalConnection;
    }

    public void checkForConnectedDevices() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        List<UsbSerialDriver> availableDrivers = UsbSerialProber.getDefaultProber().findAllDrivers(manager);

        if (availableDrivers.isEmpty()) {
            Toast.makeText(this, "No USB device found", Toast.LENGTH_SHORT).show();
            return;
        } else {
            connectUSBSerial();
        }
    }

    public UsbManager getUsbManager() {
        return (UsbManager) getSystemService(Context.USB_SERVICE);
    }

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

    public boolean checkConnection() {
        if (finalPort != null) {
            return ioManager != null && ioManager.getState() == SerialInputOutputManager.State.RUNNING;
        } else {
            return false;
        }
    }

    public class LocalBinder extends Binder {
        public USBService getService() {
            return USBService.this;
        }
    }

    public void write(byte[] bytes) {
        if (bytes != null && finalPort != null) {
            try {
                logTx(bytes);
                finalPort.write(bytes, 2000);
            } catch (IOException e) {
                Log.e(TAG, "Error writing to port: ", e);
            }
        } else {
            Toast.makeText(this, "No USB device found", Toast.LENGTH_SHORT).show();
        }
    }

    public void transmitBuffer() {
        byte[] javaBuffer = getBuffer();
        clearBuffer();
        
        int nativeBufferSize = javaBuffer.length;
        int packetSize = 50; // 12.5 bytes per frame, 10us sampling period
        long startTime = System.nanoTime();
        final long period = 4000 * 1000;
        final long flow_time_delta = 1000 * 1000;

        for (int i = 0; i < nativeBufferSize; i += packetSize) {
            int end = Math.min(i + packetSize, nativeBufferSize);
            byte[] packet = getBufferRange(javaBuffer, i, end);

            startTime += period;
            int bufferStatus = getLogStatus();
            if (bufferStatus > 200 && bufferStatus < 300) {
                write(packet);
                Log.i("TransmitBuffer", "Wrote packet: normal speed, status: " + bufferStatus);
            } else if (bufferStatus > 300) {
                write(packet);
                startTime += flow_time_delta;
                Log.i("TransmitBuffer", "Wrote packet: slower speed, status: " + bufferStatus);
            } else if (bufferStatus < 300) {
                write(packet);
                startTime -= flow_time_delta;
                Log.i("TransmitBuffer", String.format("Wrote packet: faster speed, status: %d, nanoTime: %d", 
                    bufferStatus, System.nanoTime()));
            }
            while (System.nanoTime() < startTime) {
                // Busy wait
            }
        }
        loadBuffer(javaBuffer);
    }

    public int getLogStatus() {
        int bufferStatus = getStatusNumber();
        int currentBufferLength = getBufferLength();
        Log.i("bufstatus_debug", String.format("Status: %d, Buffer length: %d, Last packet received: %d ms ago", 
            bufferStatus, 
            currentBufferLength,
            lastPacketReceivedTime != 0 ? System.currentTimeMillis() - lastPacketReceivedTime : -1));
        return bufferStatus;
    }

    private byte[] getBufferRange(byte[] buffer, int start, int end) {
        if (start < 0 || end > buffer.length || start >= end) {
            return new byte[0];
        }
        return Arrays.copyOfRange(buffer, start, end);
    }

    @Override
    public void onNewData(byte[] data) {
        lastPacketReceivedTime = System.currentTimeMillis();
        storeBulkPkt(data, lastPacketReceivedTime);
        Log.i("bulkPacket", "Received " + data.length + " bytes, total buffer length: " + getBufferLength());
    }

    // Finds the port in which the USB device is connected to. Connects to the driver and returns the port.
    public void connectUSBSerial() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        List<UsbSerialDriver> availableDrivers = UsbSerialProber.getDefaultProber().findAllDrivers(manager);

        if (availableDrivers.isEmpty()) {
            Toast.makeText(this, "No USB devices found", Toast.LENGTH_SHORT).show();
            return;
        }

        UsbSerialDriver driver = availableDrivers.get(0);
        UsbDevice device = driver.getDevice();

        // Check if permission is already granted
        if (!manager.hasPermission(device)) {
            PendingIntent usbPermissionIntent = PendingIntent.getBroadcast(
                    this,
                    0,
                    new Intent(ACTION_CONNECT_USB)
                            .putExtra(UsbManager.EXTRA_DEVICE, device),
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );
            manager.requestPermission(device, usbPermissionIntent);
        } else {
            // Permission is already granted, open the device here or handle as needed
            Toast.makeText(this, "USB permission already granted", Toast.LENGTH_SHORT).show();
            try {
                finalPort = connectUSBSerialDevice(device);
                Toast.makeText(this, "USB Connected!\nDriver: " + finalPort + "\n max pkt size: " + finalPort.getReadEndpoint().getMaxPacketSize(), Toast.LENGTH_LONG).show();
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }
    }

    private UsbSerialPort connectUSBSerialDevice(UsbDevice device) throws IOException {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) {
            Toast.makeText(this, "USB connection returned null", Toast.LENGTH_SHORT).show();
            return null;
        }

        UsbSerialDriver driver = UsbSerialProber.getDefaultProber().probeDevice(device);
        UsbSerialPort port = driver.getPorts().get(0); // Assuming there's only one port
        port.open(connection);
        port.setParameters(115200, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);

        ioManager = new SerialInputOutputManager(port, this);
        ioManager.start();

        return port;
    }

    public void connectUSBFlash() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        UsbDevice device = getUsbDevice();
        if (device != null && manager.hasPermission(device)) {
            UsbDeviceConnection connection = manager.openDevice(device);
            setUsbDeviceConnection(connection);
        }
    }

    public boolean hasUsbPermission() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                return manager.hasPermission(device);
            }
        }
        return false;
    }

    public void requestUsbPermission() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                if (!manager.hasPermission(device)) {
                    PendingIntent usbPermissionIntent = PendingIntent.getBroadcast(
                            this,
                            0,
                            new Intent(ACTION_CONNECT_USB_BOOTLOADER)
                                    .putExtra(UsbManager.EXTRA_DEVICE, device),
                            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
                    );
                    manager.requestPermission(device, usbPermissionIntent);
                }
                break;
            }
        }
    }

    public boolean isFlashDeviceConnected() {
        UsbManager manager = (UsbManager) getSystemService(Context.USB_SERVICE);
        HashMap<String, UsbDevice> deviceList = manager.getDeviceList();

        boolean deviceFound = false;
        for (UsbDevice device : deviceList.values()) {
            if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                deviceFound = true;
                break;
            }
        }
        return deviceFound;
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
                    try {
                        finalPort = connectUSBSerialDevice(device);
                        if (finalPort != null) {
                            Toast.makeText(USBService.this, "USB Connected!", Toast.LENGTH_SHORT).show();
                        }
                    } catch (IOException e) {
                        Log.e(TAG, "Error connecting USB device", e);
                        Toast.makeText(USBService.this, "USB connection failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                    }
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
        
        // Register USB permission receiver
        IntentFilter filter = new IntentFilter(ACTION_CONNECT_USB);
        registerReceiver(usbPermissionReceiver, filter);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        
        // Unregister USB permission receiver
        try {
            unregisterReceiver(usbPermissionReceiver);
        } catch (IllegalArgumentException e) {
            // Receiver was not registered, ignore
        }
        
        if (ioManager != null) {
            ioManager.stop();
            ioManager = null;
        }
        if (finalPort != null) {
            try {
                finalPort.close();
            } catch (IOException e) {
                Log.e(TAG, "Error closing USB port", e);
            }
            finalPort = null;
        }
        Log.d(TAG, "USB Service destroyed");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onRunError(Exception e) {
        Log.e(TAG, "USB serial error", e);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    public byte[] sendCommand(byte[] command, int timeout) {
        if (command != null && finalPort != null) {
            try {
                clearCommandBuffer(); // Clear any existing command/status data
                finalPort.write(command, timeout);
                logTx(command);

                // Wait for response; USB CDC/serial reads may deliver a single response in multiple chunks.
                // Collect chunks until the response "settles" (no new data for a short window) or we time out.
                final int settleWindowMs = 30;
                long startTime = System.currentTimeMillis();
                long lastDataTime = 0;
                java.io.ByteArrayOutputStream collected = new java.io.ByteArrayOutputStream();

                while (System.currentTimeMillis() - startTime < timeout) {
                    byte[] chunk = getCommand();
                    if (chunk != null && chunk.length > 0) {
                        collected.write(chunk);
                        lastDataTime = System.currentTimeMillis();
                    }

                    if (collected.size() > 0 && lastDataTime > 0
                            && (System.currentTimeMillis() - lastDataTime) >= settleWindowMs) {
                        return collected.toByteArray();
                    }

                    Thread.sleep(5); // Small delay to prevent busy waiting
                }

                if (collected.size() > 0) {
                    return collected.toByteArray();
                }
            } catch (IOException | InterruptedException e) {
                Log.e(TAG, "Error in sendCommand: ", e);
            }
        }
        return null;
    }

    public void sendPacket(byte[] data) {
        if (data != null && finalPort != null) {
            try {
                logTx(data);
                finalPort.write(data, 2000);
            } catch (IOException e) {
                Log.e(TAG, "Error writing packet: ", e);
            }
        }
    }

    // DeviceConnectionService interface methods
    
    @Override
    public ConnectionType getConnectionType() {
        return checkConnection() ? ConnectionType.USB : ConnectionType.NONE;
    }
    
    @Override
    public String getConnectionStatus() {
        if (checkConnection()) {
            return "Connected (USB)";
        } else {
            return "Not connected";
        }
    }
    
    @Override
    public void disconnect() {
        if (ioManager != null) {
            ioManager.stop();
            ioManager = null;
        }
        if (finalPort != null) {
            try {
                finalPort.close();
            } catch (IOException e) {
                Log.e(TAG, "Error closing USB port on disconnect", e);
            }
            finalPort = null;
        }
        Log.d(TAG, "USB disconnected");
    }
}
