/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

        assertEquals("192.168.4.2:3922", first.hostOrDeviceId);
        assertConnectionOwnsIsolatedSession(first, "wifi:192.168.4.2:3922", "Wi-Fi: 192.168.4.2:3922", second);
    }

    @Test
    public void webSocketUrlValidatesManualLanHosts() {
        assertEquals("ws://192.168.4.2:3922/v1/ws", AndroidWiFiTransport.webSocketUrl("192.168.4.2", 3922));
        assertEquals("ws://emwaver-a1b2.local:3922/v1/ws", AndroidWiFiTransport.webSocketUrl("emwaver-a1b2.local", 3922));
        assertEquals("ws://[fd00::1234]:3922/v1/ws", AndroidWiFiTransport.webSocketUrl("fd00::1234", 3922));
        assertEquals(null, AndroidWiFiTransport.webSocketUrl("ws://192.168.4.2", 3922));
        assertEquals(null, AndroidWiFiTransport.webSocketUrl("192.168.4.2/path", 3922));
        assertEquals(null, AndroidWiFiTransport.webSocketUrl("192.168.4.2", 70000));
    }

    @Test
    public void provisioningCommandsChunkSsidAndPassword() {
        List<byte[]> commands = AndroidWiFiTransport.provisioningCommands("bench-network", "password-with-more-than-13-bytes");

        assertNotNull(commands);
        assertArrayEquals(new byte[] { 0x0A, 0x00 }, commands.get(0));
        assertArrayEquals(new byte[] { 0x0A, 0x02 }, commands.get(commands.size() - 1));
        assertTrue(containsPrefix(commands, new byte[] { 0x0A, 0x01, 0x00, 0x00, 13 }));
        assertTrue(containsPrefix(commands, new byte[] { 0x0A, 0x01, 0x01, 0x00, 13 }));
        assertTrue(containsPrefix(commands, new byte[] { 0x0A, 0x01, 0x01, 13 }));
    }

    @Test
    public void provisioningCommandsRejectInvalidLengths() {
        assertNull(AndroidWiFiTransport.provisioningCommands(" ", "ok"));
        assertNull(AndroidWiFiTransport.provisioningCommands(repeat('s', 33), "ok"));
        assertNull(AndroidWiFiTransport.provisioningCommands("ok", repeat('p', 65)));
    }

    @Test
    public void statusMessageParsesStationIpAndRuntime() {
        byte[] response = new byte[] { (byte) 0x80, 1, 0, 1, 0, 0, 0, 1, (byte) 192, (byte) 168, 4, 2, 1 };

        assertEquals(
                "Wi-Fi is provisioned, station is online at 192.168.4.2 (idle, no disconnect reason); socket is idle; runtime is running.",
                AndroidWiFiTransport.statusMessage(response));
    }

    @Test
    public void discoveredDeviceNormalizesNsdRecord() {
        Map<String, String> metadata = new HashMap<>();
        metadata.put("host", "emwaver-a1b2");
        metadata.put("board", "esp32-s3");
        metadata.put("fw", "1.2");
        metadata.put("proto", "1");
        metadata.put("cap", "wifi,gpio");

        AndroidWiFiTransport.DiscoveredDevice device = AndroidWiFiTransport.discoveredDevice("EMWaver-A1B2", null, 3922, metadata);

        assertNotNull(device);
        assertEquals("wifi:emwaver-a1b2.local:3922", device.id);
        assertEquals("EMWaver-A1B2", device.displayName);
        assertEquals("emwaver-a1b2.local", device.host);
        assertEquals(3922, device.port);
        assertEquals("esp32s3", device.boardType);
        assertEquals("1.2", device.firmwareVersion);
        assertEquals("1", device.protocolVersion);
        assertEquals(Arrays.asList("wifi", "gpio"), device.capabilities);
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

    private static boolean containsPrefix(List<byte[]> commands, byte[] prefix) {
        for (byte[] command : commands) {
            if (command.length >= prefix.length && Arrays.equals(Arrays.copyOf(command, prefix.length), prefix)) {
                return true;
            }
        }
        return false;
    }

    private static String repeat(char value, int count) {
        char[] chars = new char[count];
        Arrays.fill(chars, value);
        return new String(chars);
    }
}
