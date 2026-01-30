/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

public enum ScriptEventType {
    TAP("tap"),
    CHANGE("change"),
    SUBMIT("submit");

    private final String rawValue;

    ScriptEventType(String rawValue) {
        this.rawValue = rawValue;
    }

    static ScriptEventType fromRaw(String raw) {
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

    String getRawValue() {
        return rawValue;
    }
}
