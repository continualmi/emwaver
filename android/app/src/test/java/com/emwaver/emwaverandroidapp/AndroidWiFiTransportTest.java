/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AndroidWiFiTransportTest {
    @Test
    public void normalizesSessionIdentityAndDisplayName() {
        assertEquals("wifi:active", AndroidWiFiTransport.sessionId(null));
        assertEquals("Wi-Fi: device", AndroidWiFiTransport.displayName(null));

        assertEquals("wifi:active", AndroidWiFiTransport.sessionId(" "));
        assertEquals("Wi-Fi: device", AndroidWiFiTransport.displayName(" "));

        assertEquals("wifi:192.168.4.2", AndroidWiFiTransport.sessionId(" 192.168.4.2 "));
        assertEquals("Wi-Fi: 192.168.4.2", AndroidWiFiTransport.displayName(" 192.168.4.2 "));
    }

    @Test
    public void connectionOwnsTransportDeviceSession() {
        AndroidWiFiTransport.Connection first = new AndroidWiFiTransport.Connection(" 192.168.4.2 ");
        AndroidWiFiTransport.Connection second = new AndroidWiFiTransport.Connection(" 192.168.4.3 ");

        assertEquals("192.168.4.2", first.hostOrDeviceId);
        assertConnectionOwnsIsolatedSession(first, "wifi:192.168.4.2", "Wi-Fi: 192.168.4.2", second);
    }

    private static void assertConnectionOwnsIsolatedSession(
            TransportDeviceConnection connection,
            String expectedSessionId,
            String expectedDisplayName,
            TransportDeviceConnection isolatedFrom
    ) {
        connection.session().appendTxBytes(new byte[] { 0x01 }, 1);

        assertEquals(expectedSessionId, connection.sessionId());
        assertEquals(expectedDisplayName, connection.displayName());
        assertEquals(expectedSessionId, connection.session().deviceId());
        assertEquals(1, connection.session().getTxPacketCount());
        assertEquals(0, isolatedFrom.session().getTxPacketCount());
    }
}
