package com.emwaver.emwaverandroidapp.wavelets;

public enum WaveletEventType {
    TAP("tap"),
    CHANGE("change"),
    SUBMIT("submit");

    private final String rawValue;

    WaveletEventType(String rawValue) {
        this.rawValue = rawValue;
    }

    static WaveletEventType fromRaw(String raw) {
        if (raw == null) {
            return null;
        }
        for (WaveletEventType type : values()) {
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
