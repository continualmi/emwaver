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

public final class NativeBuffer {
    static {
        System.loadLibrary("emwaver_buffer_android");
    }

    private NativeBuffer() {}

    // Desktop-parity: RX/TX buffer + counter + timestamps, using the Rust core.
    public static native void clearAll();
    public static native int getBufferLength();
    public static native void loadBuffer(byte[] data);
    public static native byte[] getBuffer();

    // Append raw incoming bytes; timestamps are assigned per completed 64B packet.
    public static native void storeBulkPkt(byte[] data, long tsMs);

    // Sampler-only option: invert bits (0↔1) on RX ingest when enabled.
    public static native void setInvertRx(boolean enabled);

    // Append outbound bytes to the TX log as padded 64B packets (one tsMs per 64B packet).
    public static native void appendTxBytes(byte[] data, long tsMs);

    // Buffer monitor APIs (64B packets + per-packet timestamps).
    // Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
    public static native Object[] readRxSince(long packetIndex, int maxPackets);
    public static native Object[] readTxSince(long packetIndex, int maxPackets);

    // Command-response cursor APIs (rx_counter consumption).
    public static native long getRxPacketCount();
    public static native long getRxCounter();
    public static native void setRxCounter(long value);
    // Returns Object[] { byte[] packet64, long tsMs } or null if no packet available.
    public static native Object[] nextRxPacket();

    // Sampler compression helper: returns Object[] { float[] timeValues, float[] dataValues }.
    public static native Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);

    // Protocol helpers.
    public static native byte[] makePacket64(byte[] data);
    // Returns -1 when not a BS frame.
    public static native int parseBsStatus(byte[] packet64);

    // Transmit helpers (desktop parity logic lives in Rust core; platform does I/O).
    // Returns int[] { maxPacketSize, minPacketSize, initialPacketSize, fixedDelayMs,
    //                 targetBufferLevel, bufferHighThreshold, bufferLowThreshold,
    //                 initialFillBytes, nudgeBand, stepLarge, stepSmall }.
    public static native int[] txBleProfile();
    public static native int txBleNextPacketSize(int bytesSent, int lastStatus, int currentPacketSize);

    // Returns int[] { packetSize, periodNs, flowTimeDeltaNs, bufferHighThreshold, bufferLowThreshold }.
    public static native int[] txUsbProfile();
    public static native long txUsbAdjustDeadlineNs(long deadlineNs, int lastStatus);

    // Internal RX swap used during transmit to avoid contaminating sampler capture with BS packets.
    // Returns Object[] { byte[] rxBytes, long[] rxTsMs, long rxCounter }.
    static native Object[] takeRxState();
    static native void restoreRxState(byte[] rxBytes, long[] rxTsMs, long rxCounter);

    // Compatibility helper (previous Android call sites used clearBuffer).
    public static void clearBuffer() {
        clearAll();
    }
}
