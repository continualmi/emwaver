/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TransportMetadataTest {
    @Test
    public void bleBoardTypeIsOwnedByBleTransport() {
        assertEquals("esp32s3", AndroidBleTransport.boardType());
    }

    @Test
    public void usbBoardTypeUsesExplicitHintWhenAvailable() {
        assertEquals("custom-board", AndroidUsbMidiTransport.inferBoardType(null, " custom-board "));
    }

    @Test
    public void usbBoardTypeDefaultsToStm32WithoutDeviceMetadata() {
        assertEquals("stm32f042", AndroidUsbMidiTransport.inferBoardType(null, null));
    }
}
