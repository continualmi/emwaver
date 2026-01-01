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
