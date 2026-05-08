/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TransportMetadataTest {
    @Test
    public void bleBoardTypeIsOwnedByBleTransport() {
        assertEquals("esp32s3", AndroidBleTransport.boardType());
    }

    @Test
    public void bleTransportCloseHandlesOwnsCompositeShutdown() {
        CloseProbe scan = new CloseProbe();
        CloseProbe connection = new CloseProbe();
        CloseProbe pending = new CloseProbe();

        AndroidBleTransport.closeHandles(scan, connection, pending);

        assertTrue(scan.closed);
        assertTrue(connection.closed);
        assertTrue(pending.closed);
    }

    @Test
    public void usbBoardTypeUsesExplicitHintWhenAvailable() {
        assertEquals("custom-board", AndroidUsbMidiTransport.inferBoardType(null, " custom-board "));
    }

    @Test
    public void usbBoardTypeInfersEsp32S2FromProductName() {
        assertEquals("esp32s2", AndroidUsbMidiTransport.inferBoardType("EMWaver ESP32-S2", null, null));
        assertEquals("esp32s2", AndroidUsbMidiTransport.inferBoardType("EMWaver ESP32S2", null, null));
    }

    @Test
    public void usbBoardTypeInfersGenericEsp32WithoutAssumingBleCapableS3() {
        assertEquals("esp32", AndroidUsbMidiTransport.inferBoardType("EMWaver ESP32", null, null));
        assertEquals("esp32", AndroidUsbMidiTransport.inferBoardType(null, "Espressif", null));
    }

    @Test
    public void usbBoardTypeDefaultsToStm32WithoutDeviceMetadata() {
        assertEquals("stm32f042", AndroidUsbMidiTransport.inferBoardType(null, null));
    }

    private static final class CloseProbe implements AutoCloseable {
        private boolean closed;

        @Override
        public void close() {
            closed = true;
        }
    }
}
