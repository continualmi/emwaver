package com.emwaver.emwaverandroidapp.wavelets;

import android.graphics.Color;

import java.util.Locale;

final class WaveletValueUtils {
    private WaveletValueUtils() {}

    static Double asDouble(Object value, Double fallback) {
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        if (value instanceof String) {
            try {
                return Double.parseDouble(((String) value).trim());
            } catch (NumberFormatException ignored) {
            }
        }
        return fallback;
    }

    static Float asFloat(Object value, Float fallback) {
        Double doubleValue = asDouble(value, null);
        return doubleValue != null ? doubleValue.floatValue() : fallback;
    }

    static Integer asInteger(Object value, Integer fallback) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value instanceof String) {
            try {
                return Integer.parseInt(((String) value).trim());
            } catch (NumberFormatException ignored) {
            }
        }
        return fallback;
    }

    static boolean asBoolean(Object value, boolean fallback) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue() != 0;
        }
        if (value instanceof String) {
            return Boolean.parseBoolean(((String) value).toLowerCase(Locale.US));
        }
        return fallback;
    }

    static Integer parseColor(Object value) {
        if (!(value instanceof String)) {
            return null;
        }
        String raw = ((String) value).trim();
        if (raw.isEmpty()) {
            return null;
        }
        if (raw.startsWith("#")) {
            return parseHexColor(raw.substring(1));
        }
        if (raw.startsWith("0x") || raw.startsWith("0X")) {
            return parseHexColor(raw.substring(2));
        }
        switch (raw.toLowerCase(Locale.US)) {
            case "blue":
                return Color.BLUE;
            case "green":
                return Color.GREEN;
            case "red":
                return Color.RED;
            case "orange":
                return Color.parseColor("#FFA500");
            case "yellow":
                return Color.YELLOW;
            case "pink":
                return Color.parseColor("#FFC0CB");
            case "purple":
                return Color.parseColor("#800080");
            case "gray":
            case "grey":
                return Color.GRAY;
            case "white":
                return Color.WHITE;
            case "black":
                return Color.BLACK;
            case "teal":
                return Color.parseColor("#008080");
            case "mint":
                return Color.parseColor("#3EB489");
            case "cyan":
                return Color.CYAN;
            case "indigo":
                return Color.parseColor("#4B0082");
            case "brown":
                return Color.parseColor("#A52A2A");
            case "systemgray6":
                return Color.parseColor("#F2F2F7");
            case "systemgray5":
                return Color.parseColor("#E5E5EA");
            case "systemgray4":
                return Color.parseColor("#D1D1D6");
            case "systemgray3":
                return Color.parseColor("#C7C7CC");
            case "systemgray2":
                return Color.parseColor("#AEAEB2");
            case "systemgray":
                return Color.parseColor("#8E8E93");
            default:
                return null;
        }
    }

    private static Integer parseHexColor(String raw) {
        String cleaned = raw.replace("_", "").replace(" ", "");
        try {
            if (cleaned.length() == 6) {
                return Color.parseColor("#" + cleaned);
            }
            if (cleaned.length() == 8) {
                long value = Long.parseLong(cleaned, 16);
                int a = (int) ((value >> 24) & 0xFF);
                int r = (int) ((value >> 16) & 0xFF);
                int g = (int) ((value >> 8) & 0xFF);
                int b = (int) (value & 0xFF);
                return Color.argb(a, r, g, b);
            }
        } catch (NumberFormatException ignored) {
        }
        return null;
    }
}
