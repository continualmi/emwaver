/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

public enum ScriptNodeType {
    COLUMN("column"),
    ROW("row"),
    TEXT("text"),
    BUTTON("button"),
    SLIDER("slider"),
    LOG_VIEWER("logViewer"),
    SCROLL("scroll"),
    TEXT_FIELD("textField"),
    TEXT_EDITOR("textEditor"),
    PICKER("picker"),
    GRID("grid"),
    PLOT("plot"),
    SPACER("spacer"),
    DIVIDER("divider"),
    PROGRESS("progress");

    private final String rawValue;

    ScriptNodeType(String rawValue) {
        this.rawValue = rawValue;
    }

    public static ScriptNodeType fromRaw(String raw) {
        if (raw == null) {
            return null;
        }
        for (ScriptNodeType type : values()) {
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
