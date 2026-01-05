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
 * SysEx codec matching STM32 firmware (usbd_midi_if.c).
 *
 * Format:
 *   F0 7D 'E' 'M' 'W' 0x01 <7-bit encoded payload> F7
 * where the payload decodes to exactly 64 bytes.
 */
public final class UsbMidiSysex {
    private UsbMidiSysex() {}

    private static final byte SYSEX_START = (byte) 0xF0;
    private static final byte SYSEX_END = (byte) 0xF7;

    private static final byte MANUFACTURER_ID = (byte) 0x7D;
    private static final byte[] MAGIC = new byte[] { 'E', 'M', 'W' };
    private static final byte VERSION = 0x01;

    public static byte[] encodePacket64(byte[] packet64) {
        if (packet64 == null || packet64.length != 64) {
            return null;
        }
        byte[] encoded = encodePayload7Bit(packet64);
        if (encoded == null) {
            return null;
        }

        byte[] sysex = new byte[1 + 1 + 3 + 1 + encoded.length + 1];
        int pos = 0;
        sysex[pos++] = SYSEX_START;
        sysex[pos++] = MANUFACTURER_ID;
        sysex[pos++] = MAGIC[0];
        sysex[pos++] = MAGIC[1];
        sysex[pos++] = MAGIC[2];
        sysex[pos++] = VERSION;
        System.arraycopy(encoded, 0, sysex, pos, encoded.length);
        pos += encoded.length;
        sysex[pos] = SYSEX_END;
        return sysex;
    }

    /** Returns decoded 64B packet or null when not a valid EMWaver SysEx payload. */
    public static byte[] decodeSysexToPacket64(byte[] sysex) {
        if (sysex == null || sysex.length < 8) {
            return null;
        }
        if (sysex[0] != SYSEX_START || sysex[1] != MANUFACTURER_ID) {
            return null;
        }
        if (sysex[2] != MAGIC[0] || sysex[3] != MAGIC[1] || sysex[4] != MAGIC[2]) {
            return null;
        }
        if (sysex[5] != VERSION) {
            return null;
        }
        if (sysex[sysex.length - 1] != SYSEX_END) {
            return null;
        }

        byte[] encoded = Arrays.copyOfRange(sysex, 6, sysex.length - 1);
        return decodePayload7Bit(encoded);
    }

    // --- 7-bit payload codec (matches usbd_midi_if.c) ---

    private static byte[] decodePayload7Bit(byte[] in) {
        if (in == null || in.length == 0) {
            return null;
        }
        byte[] out = new byte[64];
        int inPos = 0;
        int outPos = 0;

        while (inPos < in.length && outPos < 64) {
            int prefix = in[inPos++] & 0x7F;
            for (int j = 0; j < 7 && outPos < 64; j++) {
                if (inPos >= in.length) {
                    return null;
                }
                int v = in[inPos++] & 0x7F;
                if ((prefix & (1 << j)) != 0) {
                    v |= 0x80;
                }
                out[outPos++] = (byte) v;
            }
        }

        return outPos == 64 ? out : null;
    }

    private static byte[] encodePayload7Bit(byte[] in64) {
        if (in64 == null || in64.length != 64) {
            return null;
        }
        // Worst-case: ceil(64/7) * (1 + 7) = 10 * 8 = 80.
        byte[] out = new byte[96];
        int outPos = 0;
        int inPos = 0;

        while (inPos < 64) {
            int prefix = 0;
            byte[] chunk = new byte[7];
            int chunkLen = 0;

            for (int j = 0; j < 7 && inPos < 64; j++) {
                int b = in64[inPos++] & 0xFF;
                if ((b & 0x80) != 0) {
                    prefix |= (1 << j);
                }
                chunk[j] = (byte) (b & 0x7F);
                chunkLen++;
            }

            if (outPos + 1 + chunkLen > out.length) {
                return null;
            }
            out[outPos++] = (byte) (prefix & 0x7F);
            System.arraycopy(chunk, 0, out, outPos, chunkLen);
            outPos += chunkLen;
        }

        return Arrays.copyOf(out, outPos);
    }
}
