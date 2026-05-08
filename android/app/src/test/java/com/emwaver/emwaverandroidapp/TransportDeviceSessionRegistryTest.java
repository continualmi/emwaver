/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertSame;

import org.junit.Test;

public class TransportDeviceSessionRegistryTest {
    @Test
    public void selectWithoutResetPreservesExistingSessionBuffers() {
        TransportDeviceSessionRegistry registry = new TransportDeviceSessionRegistry();
        TransportDeviceSession usb = registry.select("usb:test", true);
        byte[] packet = packet((byte) 0x33);
        usb.storeBulkPkt(packet, 100);

        TransportDeviceSession selected = registry.select("usb:test", false);

        assertSame(usb, selected);
        assertEquals(1, selected.getRxPacketCount());
        assertArrayEquals(packet, selected.getBuffer());
    }

    @Test
    public void selectWithResetClearsExistingSessionBuffers() {
        TransportDeviceSessionRegistry registry = new TransportDeviceSessionRegistry();
        TransportDeviceSession usb = registry.select("usb:test", true);
        usb.storeBulkPkt(packet((byte) 0x44), 100);

        TransportDeviceSession selected = registry.select("usb:test", true);

        assertSame(usb, selected);
        assertEquals(0, selected.getRxPacketCount());
        assertEquals(0, selected.getBuffer().length);
    }

    @Test
    public void separateDeviceIdsResolveToSeparateSessions() {
        TransportDeviceSessionRegistry registry = new TransportDeviceSessionRegistry();

        TransportDeviceSession usb = registry.session("usb:test");
        TransportDeviceSession ble = registry.session("ble:test");

        assertNotSame(usb, ble);
        assertEquals("usb:test", usb.deviceId());
        assertEquals("ble:test", ble.deviceId());
    }

    private static byte[] packet(byte value) {
        byte[] packet = new byte[UsbMidiSysex.LANE_SIZE];
        for (int i = 0; i < packet.length; i++) {
            packet[i] = value;
        }
        return packet;
    }
}
