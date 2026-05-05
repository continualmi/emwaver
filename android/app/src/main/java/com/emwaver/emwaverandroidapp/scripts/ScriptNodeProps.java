/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

public final class ScriptNodeProps {
    public static final String HANDLER_METADATA_KEY = "_scriptHandlers";

    private final Map<String, Object> raw;
    private final EnumMap<ScriptEventType, String> eventHandlers;

    public ScriptNodeProps(Map<String, Object> raw, Map<ScriptEventType, String> handlers) {
        this.raw = raw != null ? Collections.unmodifiableMap(raw) : Collections.emptyMap();
        EnumMap<ScriptEventType, String> map = new EnumMap<>(ScriptEventType.class);
        if (handlers != null) {
            map.putAll(handlers);
        }
        this.eventHandlers = map;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public String getHandlerToken(ScriptEventType type) {
        if (type == null) {
            return null;
        }
        String token = eventHandlers.get(type);
        if (token != null) {
            return token;
        }
        Map<String, Object> metadata = getMap(HANDLER_METADATA_KEY);
        if (metadata != null) {
            Object fallback = metadata.get(type.getRawValue());
            if (fallback != null) {
                return String.valueOf(fallback);
            }
        }
        return null;
    }

    public Map<ScriptEventType, String> getEventHandlers() {
        return Collections.unmodifiableMap(eventHandlers);
    }

    public Object get(String key) {
        return raw.get(key);
    }

    public String getString(String key) {
        Object value = raw.get(key);
        return value != null ? String.valueOf(value) : null;
    }

    public Double getDouble(String key) {
        Object value = raw.get(key);
        return ScriptValueUtils.asDouble(value, null);
    }

    public Boolean getBoolean(String key) {
        Object value = raw.get(key);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue() != 0;
        }
        if (value != null) {
            return Boolean.parseBoolean(String.valueOf(value));
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getMap(String key) {
        Object value = raw.get(key);
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    public List<Object> getList(String key) {
        Object value = raw.get(key);
        if (value instanceof List) {
            return (List<Object>) value;
        }
        return Collections.emptyList();
    }
}
