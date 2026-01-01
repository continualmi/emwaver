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
