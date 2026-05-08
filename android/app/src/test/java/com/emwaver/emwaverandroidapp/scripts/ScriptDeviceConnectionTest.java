/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import com.emwaver.emwaverandroidapp.DeviceConnectionService;

import org.junit.Test;

public class ScriptDeviceConnectionTest {
    @Test
    public void capturedConnectionRoutesScriptIoThroughCapturedDeviceId() {
        FakeDeviceConnectionService service = new FakeDeviceConnectionService("USB:Board-1");
        ScriptDeviceConnection connection = new ScriptDeviceConnection(service, "USB Board");
        byte[] payload = new byte[] { 0x01, 0x02 };

        connection.write(payload);
        byte[] response = connection.sendCommand(payload, 500);
        connection.transmitBuffer();
        connection.clearBuffer();
        connection.loadBuffer(payload);
        connection.getBufferLength();
        connection.getBuffer();

        assertEquals("USB:Board-1", service.lastWriteDeviceId);
        assertEquals("USB:Board-1", service.lastCommandDeviceId);
        assertEquals("USB:Board-1", service.lastTransmitDeviceId);
        assertEquals("USB:Board-1", service.lastClearDeviceId);
        assertEquals("USB:Board-1", service.lastLoadDeviceId);
        assertEquals("USB:Board-1", service.lastLengthDeviceId);
        assertEquals("USB:Board-1", service.lastGetDeviceId);
        assertArrayEquals(new byte[] { 0x7F }, response);
        assertEquals("USB:Board-1", connection.capturedDeviceId());
        assertEquals("USB", connection.connectionType());
        assertEquals("USB Board", connection.connectionStatus());
    }

    @Test
    public void capturedConnectionNormalizesCapturedDeviceId() {
        FakeDeviceConnectionService service = new FakeDeviceConnectionService(" USB:Board-1 ");
        ScriptDeviceConnection connection = new ScriptDeviceConnection(service, "USB Board");
        byte[] payload = new byte[] { 0x01, 0x02 };

        connection.write(payload);

        assertEquals("USB:Board-1", connection.capturedDeviceId());
        assertEquals("USB:Board-1", service.lastWriteDeviceId);
    }

    private static final class FakeDeviceConnectionService implements DeviceConnectionService {
        private final String deviceId;
        private String lastWriteDeviceId;
        private String lastCommandDeviceId;
        private String lastTransmitDeviceId;
        private String lastClearDeviceId;
        private String lastLoadDeviceId;
        private String lastLengthDeviceId;
        private String lastGetDeviceId;

        private FakeDeviceConnectionService(String deviceId) {
            this.deviceId = deviceId;
        }

        @Override
        public void write(byte[] bytes) {}

        @Override
        public void write(byte[] bytes, String deviceId) {
            lastWriteDeviceId = deviceId;
        }

        @Override
        public byte[] sendCommand(byte[] command, int timeout) {
            return null;
        }

        @Override
        public byte[] sendCommand(byte[] command, int timeout, String deviceId) {
            lastCommandDeviceId = deviceId;
            return new byte[] { 0x7F };
        }

        @Override
        public void sendPacket(byte[] data) {}

        @Override
        public boolean checkConnection() {
            return true;
        }

        @Override
        public void transmitBuffer() {}

        @Override
        public void transmitBuffer(String deviceId) {
            lastTransmitDeviceId = deviceId;
        }

        @Override
        public void clearBuffer() {}

        @Override
        public void clearBuffer(String deviceId) {
            lastClearDeviceId = deviceId;
        }

        @Override
        public int getBufferLength() {
            return 0;
        }

        @Override
        public int getBufferLength(String deviceId) {
            lastLengthDeviceId = deviceId;
            return 2;
        }

        @Override
        public void loadBuffer(byte[] data) {}

        @Override
        public void loadBuffer(byte[] data, String deviceId) {
            lastLoadDeviceId = deviceId;
        }

        @Override
        public byte[] getBuffer() {
            return null;
        }

        @Override
        public byte[] getBuffer(String deviceId) {
            lastGetDeviceId = deviceId;
            return new byte[] { 0x01, 0x02 };
        }

        @Override
        public String currentScriptDeviceId() {
            return deviceId;
        }

        @Override
        public Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
            return new Object[0];
        }

        @Override
        public ConnectionType getConnectionType() {
            return ConnectionType.USB;
        }

        @Override
        public String getConnectionStatus() {
            return "USB Connected";
        }

        @Override
        public void disconnect() {}
    }
}
