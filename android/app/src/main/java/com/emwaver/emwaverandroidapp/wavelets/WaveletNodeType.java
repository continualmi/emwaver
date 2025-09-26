package com.emwaver.emwaverandroidapp.wavelets;

public enum WaveletNodeType {
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
    SPACER("spacer"),
    DIVIDER("divider"),
    PROGRESS("progress");

    private final String rawValue;

    WaveletNodeType(String rawValue) {
        this.rawValue = rawValue;
    }

    public static WaveletNodeType fromRaw(String raw) {
        if (raw == null) {
            return null;
        }
        for (WaveletNodeType type : values()) {
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
