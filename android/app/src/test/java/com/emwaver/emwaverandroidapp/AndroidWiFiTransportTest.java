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
}
