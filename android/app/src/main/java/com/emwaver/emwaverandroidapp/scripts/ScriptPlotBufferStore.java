/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import androidx.annotation.Nullable;

import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

final class ScriptPlotBufferStore {
    private static final Map<String, Supplier<byte[]>> providers = new ConcurrentHashMap<>();
    private static final Map<String, byte[]> buffers = new ConcurrentHashMap<>();

    private ScriptPlotBufferStore() {}

    static void setProvider(String id, @Nullable Supplier<byte[]> provider) {
        if (id == null || id.trim().isEmpty()) {
            return;
        }
        String key = id.trim();
        if (provider == null) {
            providers.remove(key);
        } else {
            providers.put(key, provider);
        }
    }

    static void setBuffer(String id, byte[] data) {
        if (id == null || id.trim().isEmpty()) {
            return;
        }
        String key = id.trim();
        byte[] safe = data != null ? Arrays.copyOf(data, data.length) : new byte[0];
        buffers.put(key, safe);
    }

    static void clearBuffer(String id) {
        if (id == null || id.trim().isEmpty()) {
            return;
        }
        buffers.remove(id.trim());
    }

    static byte[] resolve(String id) {
        if (id == null || id.trim().isEmpty()) {
            return new byte[0];
        }
        String key = id.trim();

        Supplier<byte[]> provider = providers.get(key);
        if (provider != null) {
            try {
                byte[] data = provider.get();
                return data != null ? Arrays.copyOf(data, data.length) : new byte[0];
            } catch (Exception ignored) {
                return new byte[0];
            }
        }

        byte[] data = buffers.get(key);
        return data != null ? Arrays.copyOf(data, data.length) : new byte[0];
    }
}
