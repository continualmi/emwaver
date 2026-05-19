/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class SimulatorScriptDeviceBridgeTest {
    @Test
    public void sharedBasicBoardFixtureDrivesProtocolCommands() throws Exception {
        SimulatorScriptDeviceBridge bridge = SimulatorScriptDeviceBridge.fromFixtureJson(readFixture());

        assertEquals("emwaver-sim", textReply(bridge.sendPacket(new byte[]{0x09}, 1500)));
        assertArrayEquals(new byte[]{(byte) 0x80, 0x00, 0x08}, bridge.sendPacket(new byte[]{0x20, 0x00, 0x00}, 1500));
        assertArrayEquals(new byte[]{(byte) 0x80}, bridge.sendPacket(new byte[]{0x10, 0x01, 0x0d}, 1500));
        assertArrayEquals(new byte[]{(byte) 0x80}, bridge.sendPacket(new byte[]{0x10, 0x03, 0x0d}, 1500));
        assertArrayEquals(new byte[]{(byte) 0x80, 0x01}, bridge.sendPacket(new byte[]{0x10, 0x02, 0x0d}, 1500));
    }

    private static String textReply(byte[] response) {
        assertEquals((byte) 0x80, response[0]);
        return new String(response, 1, response.length - 1, StandardCharsets.UTF_8);
    }

    private static String readFixture() throws Exception {
        Path cwd = Paths.get("").toAbsolutePath();
        Path[] candidates = new Path[]{
                cwd.resolve("../simulator/fixtures/basic-board.json").normalize(),
                cwd.resolve("simulator/fixtures/basic-board.json").normalize(),
                cwd.resolve("../../simulator/fixtures/basic-board.json").normalize()
        };
        for (Path candidate : candidates) {
            if (Files.exists(candidate)) {
                return new String(Files.readAllBytes(candidate), StandardCharsets.UTF_8);
            }
        }
        throw new AssertionError("Missing shared simulator fixture: " + candidates[0]);
    }
}
