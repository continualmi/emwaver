/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.wavelets;

import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

public final class WaveletNodeProps {
    public static final String HANDLER_METADATA_KEY = "_waveletHandlers";

    private final Map<String, Object> raw;
    private final EnumMap<WaveletEventType, String> eventHandlers;

    public WaveletNodeProps(Map<String, Object> raw, Map<WaveletEventType, String> handlers) {
        this.raw = raw != null ? Collections.unmodifiableMap(raw) : Collections.emptyMap();
        EnumMap<WaveletEventType, String> map = new EnumMap<>(WaveletEventType.class);
        if (handlers != null) {
            map.putAll(handlers);
        }
        this.eventHandlers = map;
    }

    public Map<String, Object> getRaw() {
        return raw;
    }

    public String getHandlerToken(WaveletEventType type) {
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

    public Map<WaveletEventType, String> getEventHandlers() {
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
        return WaveletValueUtils.asDouble(value, null);
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
