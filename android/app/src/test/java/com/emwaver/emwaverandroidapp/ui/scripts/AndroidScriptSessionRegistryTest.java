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
import java.util.concurrent.atomic.AtomicInteger;

public class AndroidScriptSessionRegistryTest {
    @Test
    public void keepsMultipleVisibleSessionsAndStopsOne() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();
        AtomicInteger firstStops = new AtomicInteger();
        AtomicInteger secondStops = new AtomicInteger();

        AndroidScriptSession first = registry.start(firstStops::incrementAndGet, "script-a", "Alpha", "USB A", "usb:a");
        AndroidScriptSession second = registry.start(secondStops::incrementAndGet, "script-b", "Beta", "USB B", "usb:b");

        assertTrue(registry.hasSessions());
        assertEquals(second.instanceId, registry.selectedSession().instanceId);
        assertEquals(Arrays.asList(first.instanceId, second.instanceId), sessionIds(registry.sessions()));

        registry.stop(first.instanceId);

        assertEquals(1, firstStops.get());
        assertEquals(0, secondStops.get());
        assertEquals(1, registry.sessions().size());
        assertEquals(second.instanceId, registry.selectedSession().instanceId);
        assertEquals("usb:b", registry.selectedSession().deviceId);
        assertEquals("Beta.emw", registry.selectedSession().fileName());
        assertEquals("Running on USB B", registry.selectedSession().statusLabel());
    }

    @Test
    public void selectedFallsBackToPreviousSessionAfterStop() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();
        AtomicInteger firstStops = new AtomicInteger();
        AtomicInteger secondStops = new AtomicInteger();

        AndroidScriptSession first = registry.start(firstStops::incrementAndGet, "script-a", "Alpha", "USB A", "usb:a");
        AndroidScriptSession second = registry.start(secondStops::incrementAndGet, "script-b", "Beta", "USB B", "usb:b");

        registry.stop(second.instanceId);

        assertEquals(0, firstStops.get());
        assertEquals(1, secondStops.get());
        assertEquals(first.instanceId, registry.selectedSession().instanceId);

        registry.stopSelected();

        assertEquals(1, firstStops.get());
        assertFalse(registry.hasSessions());
    }

    @Test
    public void clearStopsAllOwnedSessionRuntimes() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();
        AtomicInteger stops = new AtomicInteger();

        registry.start(stops::incrementAndGet, "script-a", "Alpha", "USB A", "usb:a");
        registry.start(stops::incrementAndGet, "script-b", "Beta", "USB B", "usb:b");

        registry.clear();

        assertEquals(2, stops.get());
        assertFalse(registry.hasSessions());
    }

    @Test
    public void stopSelectedRuntimeKeepsStoppedSessionVisible() {
        AndroidScriptSessionRegistry registry = new AndroidScriptSessionRegistry();
        AtomicInteger stops = new AtomicInteger();

        AndroidScriptSession first = registry.start(stops::incrementAndGet, "script-a", "Alpha", "USB A", "usb:a");

        registry.stopSelectedRuntime();
        AndroidScriptSession second = registry.start(stops::incrementAndGet, "script-b", "Beta", "USB B", "usb:b");

        assertEquals(1, stops.get());
        assertEquals(second.instanceId, registry.selectedSession().instanceId);
        assertEquals(Arrays.asList(first.instanceId, second.instanceId), sessionIds(registry.sessions()));
        assertEquals("Stopped on USB A", registry.sessions().get(0).statusLabel());
        assertEquals("Running on USB B", registry.sessions().get(1).statusLabel());
        assertFalse(registry.sessions().get(0).isRunning());
        assertTrue(registry.sessions().get(1).isRunning());

        registry.stop(first.instanceId);

        assertEquals(1, stops.get());
        assertEquals(1, registry.sessions().size());
    }

    private static List<String> sessionIds(List<AndroidScriptSession> sessions) {
        java.util.ArrayList<String> ids = new java.util.ArrayList<>();
        for (AndroidScriptSession session : sessions) {
            ids.add(session.instanceId);
        }
        return ids;
    }
}
