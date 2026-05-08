/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class AndroidScriptSessionRegistryTest {
    @Test
    public void keepsMultipleVisibleSessionsAndStopsOne() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();

        AndroidScriptSession first = registry.start("script-a", "Alpha", "USB A", "usb:a");
        AndroidScriptSession second = registry.start("script-b", "Beta", "USB B", "usb:b");

        assertTrue(registry.hasSessions());
        assertEquals(second.instanceId, registry.selectedSession().instanceId);
        assertEquals(Arrays.asList(first.instanceId, second.instanceId), sessionIds(registry.sessions()));

        registry.stop(first.instanceId);

        assertEquals(1, registry.sessions().size());
        assertEquals(second.instanceId, registry.selectedSession().instanceId);
        assertEquals("usb:b", registry.selectedSession().deviceId);
        assertEquals("Beta.emw", registry.selectedSession().fileName());
        assertEquals("Running on USB B", registry.selectedSession().statusLabel());
    }

    @Test
    public void selectedFallsBackToPreviousSessionAfterStop() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();

        AndroidScriptSession first = registry.start("script-a", "Alpha", "USB A", "usb:a");
        AndroidScriptSession second = registry.start("script-b", "Beta", "USB B", "usb:b");

        registry.stop(second.instanceId);

        assertEquals(first.instanceId, registry.selectedSession().instanceId);

        registry.stopSelected();

        assertFalse(registry.hasSessions());
    }

    private static List<String> sessionIds(List<AndroidScriptSession> sessions) {
        java.util.ArrayList<String> ids = new java.util.ArrayList<>();
        for (AndroidScriptSession session : sessions) {
            ids.add(session.instanceId);
        }
        return ids;
    }
}
