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

package com.emwaver.emwaverandroidapp;

import java.util.Arrays;

/**
 * SysEx codec matching the STM32 mini-frame tunnel (usb_midi_if.c).
 *
 * Fixed-size SysEx message (48 bytes):
 *   F0 7D 'E' 'M' 'W' <42 encoded bytes> F7
 *
 * The 42 encoded bytes decode to 36 raw bytes split into two 18-byte lanes:
 *   - cmd lane:   18 bytes
 *   - stream lane:18 bytes
 */
public final class UsbMidiSysex {
    private UsbMidiSysex() {}

    private static final byte SYSEX_START = (byte) 0xF0;
    private static final byte SYSEX_END = (byte) 0xF7;

    private static final byte MANUFACTURER_ID = (byte) 0x7D;
    private static final byte[] MAGIC = new byte[] { 'E', 'M', 'W' };

    public static final int LANE_SIZE = 18;
    public static final int FRAME_SIZE = 36;
    public static final int ENCODED_BYTES = 42;
    public static final int SYSEX_BYTES = 48;

    public static byte[] encodeFrame(byte[] frame36) {
        if (frame36 == null || frame36.length != FRAME_SIZE) {
            return null;
        }

        byte[] encoded = encodePayload7BitFixed(frame36);
        if (encoded == null || encoded.length != ENCODED_BYTES) {
            return null;
        }

        byte[] sysex = new byte[SYSEX_BYTES];
        int pos = 0;
        sysex[pos++] = SYSEX_START;
        sysex[pos++] = MANUFACTURER_ID;
        sysex[pos++] = MAGIC[0];
        sysex[pos++] = MAGIC[1];
        sysex[pos++] = MAGIC[2];
        System.arraycopy(encoded, 0, sysex, pos, ENCODED_BYTES);
        pos += ENCODED_BYTES;
        sysex[pos] = SYSEX_END;
        return sysex;
    }

    public static byte[] encodeLanes(byte[] cmdLane18, byte[] streamLane18) {
        if (cmdLane18 == null || streamLane18 == null) {
            return null;
        }
        if (cmdLane18.length != LANE_SIZE || streamLane18.length != LANE_SIZE) {
            return null;
        }

        byte[] frame = new byte[FRAME_SIZE];
        System.arraycopy(cmdLane18, 0, frame, 0, LANE_SIZE);
        System.arraycopy(streamLane18, 0, frame, LANE_SIZE, LANE_SIZE);
        return encodeFrame(frame);
    }

    /** Returns decoded 36B frame or null when not a valid EMWaver mini-frame SysEx payload. */
    public static byte[] decodeSysexToFrame(byte[] sysex) {
        if (sysex == null || sysex.length != SYSEX_BYTES) {
            return null;
        }
        if (sysex[0] != SYSEX_START || sysex[1] != MANUFACTURER_ID) {
            return null;
        }
        if (sysex[2] != MAGIC[0] || sysex[3] != MAGIC[1] || sysex[4] != MAGIC[2]) {
            return null;
        }
        if (sysex[SYSEX_BYTES - 1] != SYSEX_END) {
            return null;
        }

        byte[] encoded = Arrays.copyOfRange(sysex, 5, SYSEX_BYTES - 1);
        if (encoded.length != ENCODED_BYTES) {
            return null;
        }
        return decodePayload7BitFixed(encoded);
    }

    // --- 7-bit payload codec (fixed-size; matches firmware mini-frame) ---

    private static byte[] decodePayload7BitFixed(byte[] in42) {
        if (in42 == null || in42.length != ENCODED_BYTES) {
            return null;
        }
        byte[] out = new byte[FRAME_SIZE];
        int inPos = 0;
        int outPos = 0;

        while (inPos < ENCODED_BYTES && outPos < FRAME_SIZE) {
            int prefix = in42[inPos++] & 0x7F;
            for (int bit = 0; bit < 7 && outPos < FRAME_SIZE; bit++) {
                if (inPos >= ENCODED_BYTES) {
                    return null;
                }
                int v = in42[inPos++] & 0x7F;
                if ((prefix & (1 << bit)) != 0) {
                    v |= 0x80;
                }
                out[outPos++] = (byte) v;
            }
        }

        return outPos == FRAME_SIZE ? out : null;
    }

    private static byte[] encodePayload7BitFixed(byte[] in36) {
        if (in36 == null || in36.length != FRAME_SIZE) {
            return null;
        }

        byte[] out = new byte[ENCODED_BYTES];
        int outPos = 0;
        int inPos = 0;

        while (inPos < FRAME_SIZE && outPos < ENCODED_BYTES) {
            int prefix = 0;
            int chunkLen = Math.min(7, FRAME_SIZE - inPos);
            if (outPos + 1 + chunkLen > ENCODED_BYTES) {
                return null;
            }

            int prefixPos = outPos;
            outPos += 1;

            for (int j = 0; j < chunkLen; j++) {
                int b = in36[inPos++] & 0xFF;
                if ((b & 0x80) != 0) {
                    prefix |= (1 << j);
                }
                out[outPos++] = (byte) (b & 0x7F);
            }

            out[prefixPos] = (byte) (prefix & 0x7F);
        }

        return outPos == ENCODED_BYTES ? out : null;
    }
}
