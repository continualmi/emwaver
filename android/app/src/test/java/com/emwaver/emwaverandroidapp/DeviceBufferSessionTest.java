/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class DeviceBufferSessionTest {
    @Test
    public void separateSessionsKeepRxBuffersAndCountersIsolated() {
        DeviceBufferSession usb = new DeviceBufferSession();
        DeviceBufferSession ble = new DeviceBufferSession();

        byte[] usbPacket = packet((byte) 0x11);
        byte[] blePacket = packet((byte) 0x22);

        usb.storeBulkPkt(usbPacket, 100);
        ble.storeBulkPkt(blePacket, 200);

        assertEquals(1, usb.getRxPacketCount());
        assertEquals(1, ble.getRxPacketCount());
        assertArrayEquals(usbPacket, usb.getBuffer());
        assertArrayEquals(blePacket, ble.getBuffer());

        Object[] usbNext = usb.nextRxPacket();
        assertNotNull(usbNext);
        assertArrayEquals(usbPacket, (byte[]) usbNext[0]);
        assertNull(usb.nextRxPacket());

        Object[] bleNext = ble.nextRxPacket();
        assertNotNull(bleNext);
        assertArrayEquals(blePacket, (byte[]) bleNext[0]);
    }

    @Test
    public void separateSessionsKeepSamplerStreamingStateIsolated() {
        DeviceBufferSession usb = new DeviceBufferSession();
        DeviceBufferSession ble = new DeviceBufferSession();

        byte[] samplerStart = new byte[UsbMidiSysex.LANE_SIZE];
        samplerStart[0] = 0x60;
        samplerStart[1] = 0x00;
        usb.updateSamplerStreamingState(samplerStart);

        byte[] emptyLane = new byte[UsbMidiSysex.LANE_SIZE];
        byte[] emptySuperframe = UsbMidiSysex.encodeLanes(emptyLane, emptyLane);

        usb.feedSysexBytes(emptySuperframe, 0, emptySuperframe.length, 300);
        ble.feedSysexBytes(emptySuperframe, 0, emptySuperframe.length, 300);

        assertEquals(1, usb.getRxPacketCount());
        assertEquals(0, ble.getRxPacketCount());
    }

    @Test
    public void separateSessionsKeepTxBuffersIsolated() {
        DeviceBufferSession usb = new DeviceBufferSession();
        DeviceBufferSession ble = new DeviceBufferSession();

        byte[] usbPacket = packet((byte) 0x55);
        byte[] blePacket = packet((byte) 0x66);

        usb.appendTxBytes(usbPacket, 500);
        ble.appendTxBytes(blePacket, 600);

        assertEquals(1, usb.getTxPacketCount());
        assertEquals(1, ble.getTxPacketCount());
        assertArrayEquals(usbPacket, usb.getTxBuffer());
        assertArrayEquals(blePacket, ble.getTxBuffer());
    }

    private static byte[] packet(byte value) {
        byte[] packet = new byte[UsbMidiSysex.LANE_SIZE];
        for (int i = 0; i < packet.length; i++) {
            packet[i] = value;
        }
        return packet;
    }
}
