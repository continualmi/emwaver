/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

public enum ScriptEventType {
    TAP("tap"),
    CHANGE("change"),
    SUBMIT("submit"),
    VIEWPORT("viewport");

    private final String rawValue;

    ScriptEventType(String rawValue) {
        this.rawValue = rawValue;
    }

    public static ScriptEventType fromRaw(String raw) {
        if (raw == null) {
            return null;
        }
        for (ScriptEventType type : values()) {
            if (type.rawValue.equalsIgnoreCase(raw)) {
                return type;
            }
        }
        return null;
    }

    public String getRawValue() {
        return rawValue;
    }
}
