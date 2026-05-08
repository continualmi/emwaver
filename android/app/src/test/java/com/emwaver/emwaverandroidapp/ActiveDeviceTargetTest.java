/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ActiveDeviceTargetTest {
    private enum Transport {
        NONE,
        USB,
        BLE
    }

    @Test
    public void normalizesBlankDeviceIdToActive() {
        ActiveDeviceTarget<Transport> target = new ActiveDeviceTarget<>("   ", Transport.NONE);

        assertEquals("active", target.deviceId);
        assertTrue(target.matchesDeviceId(null));
        assertTrue(target.matchesDeviceId(""));
    }

    @Test
    public void matchesExactTrimmedDeviceIdAndTransport() {
        ActiveDeviceTarget<Transport> target = new ActiveDeviceTarget<>(" usb:board-1 ", Transport.USB);

        assertEquals("usb:board-1", target.deviceId);
        assertTrue(target.matchesDeviceId("usb:board-1"));
        assertFalse(target.matchesDeviceId("ble:board-1"));
        assertTrue(target.matchesTransport(Transport.USB));
        assertFalse(target.matchesTransport(Transport.BLE));
    }
}
