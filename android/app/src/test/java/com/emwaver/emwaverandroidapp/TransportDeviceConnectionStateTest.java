/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TransportDeviceConnectionStateTest {
    @Test
    public void currentScriptDeviceIdFollowsActiveConnectionWhenPresent() {
        TransportDeviceConnectionState<String> state = new TransportDeviceConnectionState<>("none");
        ActiveDeviceTarget<String> target = state.setTarget(" usb:target ", "usb");
        FakeConnection connection = new FakeConnection("usb:connection", "USB Board");

        state.setConnection(connection);

        assertEquals("usb:target", target.deviceId);
        assertEquals("usb:connection", state.currentScriptDeviceId());
        assertSame(connection, state.connection());
        assertTrue(state.matchesDeviceId("USB:TARGET"));
        assertTrue(state.matchesTransport("usb"));
    }

    @Test
    public void clearingMatchingTransportDropsConnectionAndResetsTarget() {
        TransportDeviceConnectionState<String> state = new TransportDeviceConnectionState<>("none");
        state.setTarget("ble:board", "ble");
        state.setConnection(new FakeConnection("ble:board", "BLE Board"));

        state.clear("usb");
        assertEquals("ble:board", state.currentScriptDeviceId());

        state.clear("ble");
        assertEquals("active", state.currentScriptDeviceId());
        assertEquals("none", state.transport());
        assertFalse(state.matchesDeviceId("ble:board"));
    }

    private static final class FakeConnection implements TransportDeviceConnection {
        private final String sessionId;
        private final String displayName;
        private final TransportDeviceSession session;

        private FakeConnection(String sessionId, String displayName) {
            this.sessionId = sessionId;
            this.displayName = displayName;
            this.session = new DeviceBufferSession(sessionId);
        }

        @Override
        public String sessionId() {
            return sessionId;
        }

        @Override
        public String displayName() {
            return displayName;
        }

        @Override
        public TransportDeviceSession session() {
            return session;
        }
    }
}
