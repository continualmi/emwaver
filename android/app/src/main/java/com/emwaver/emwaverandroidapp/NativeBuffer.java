/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp;

import java.util.Arrays;

// Android: intentionally avoid the Rust JNI buffer-core.
// This keeps the same public API that USBService expects, but implements the
// buffer logic in pure Java.
public final class NativeBuffer {
    private NativeBuffer() {}

    // PACKET_SIZE from the (former) Rust buffer core: fixed 18B.
    private static final int PACKET_SIZE_BYTES = 18;

    private static final Object LOCK = new Object();

    // RX log
    private static byte[] rxBytes = new byte[0];
    // One timestamp per completed 18B packet.
    private static long[] rxTsMs = new long[0];
    // Packet cursor used by nextRxPacket.
    private static long rxCounter = 0;

    // TX log (stored as padded 18B packets)
    private static byte[] txBytes = new byte[0];
    // One timestamp per 18B packet.
    private static long[] txTsMs = new long[0];

    // --- Buffer core ---

    public static void clearAll() {
        synchronized (LOCK) {
            rxBytes = new byte[0];
            rxTsMs = new long[0];
            rxCounter = 0;
            txBytes = new byte[0];
            txTsMs = new long[0];
        }
    }

    public static int getBufferLength() {
        synchronized (LOCK) {
            return rxBytes.length;
        }
    }

    public static void loadBuffer(byte[] data) {
        synchronized (LOCK) {
            rxBytes = data != null ? Arrays.copyOf(data, data.length) : new byte[0];
            rxCounter = 0;
            int packets = rxBytes.length / PACKET_SIZE_BYTES;
            rxTsMs = new long[packets];
        }
    }

    public static byte[] getBuffer() {
        synchronized (LOCK) {
            return Arrays.copyOf(rxBytes, rxBytes.length);
        }
    }

    public static void storeBulkPkt(byte[] data, long tsMs) {
        if (data == null || data.length == 0) return;

        synchronized (LOCK) {
            int prevPackets = rxBytes.length / PACKET_SIZE_BYTES;
            rxBytes = appendBytes(rxBytes, data);
            int newPackets = rxBytes.length / PACKET_SIZE_BYTES;
            int delta = Math.max(0, newPackets - prevPackets);
            if (delta > 0) {
                rxTsMs = appendRepeated(rxTsMs, tsMs, delta);
            }
        }
    }

    public static void appendTxBytes(byte[] data, long tsMs) {
        if (data == null || data.length == 0) return;

        synchronized (LOCK) {
            for (int offset = 0; offset < data.length; offset += PACKET_SIZE_BYTES) {
                int take = Math.min(PACKET_SIZE_BYTES, data.length - offset);
                byte[] pkt = new byte[PACKET_SIZE_BYTES];
                System.arraycopy(data, offset, pkt, 0, take);
                txBytes = appendBytes(txBytes, pkt);
                txTsMs = appendRepeated(txTsMs, tsMs, 1);
            }
        }
    }

    // Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
    public static Object[] readRxSince(long packetIndex, int maxPackets) {
        synchronized (LOCK) {
            long available = rxBytes.length / (long) PACKET_SIZE_BYTES;
            if (available == 0 || maxPackets <= 0 || packetIndex >= available) {
                return new Object[] { new byte[0], new long[0], Math.min(packetIndex, available), available };
            }

            long toRead = Math.min((long) maxPackets, available - packetIndex);
            int startByte = (int) (packetIndex * PACKET_SIZE_BYTES);
            int endByte = Math.min(rxBytes.length, startByte + (int) toRead * PACKET_SIZE_BYTES);

            byte[] outData = Arrays.copyOfRange(rxBytes, startByte, endByte);

            int tsStart = (int) packetIndex;
            int tsEnd = Math.min(rxTsMs.length, tsStart + (int) toRead);
            long[] outTs = tsStart < tsEnd ? Arrays.copyOfRange(rxTsMs, tsStart, tsEnd) : new long[0];

            return new Object[] { outData, outTs, packetIndex + toRead, available };
        }
    }

    public static Object[] readTxSince(long packetIndex, int maxPackets) {
        synchronized (LOCK) {
            long available = txTsMs.length;
            if (available == 0 || maxPackets <= 0 || packetIndex >= available) {
                return new Object[] { new byte[0], new long[0], Math.min(packetIndex, available), available };
            }

            long toRead = Math.min((long) maxPackets, available - packetIndex);
            int startByte = (int) (packetIndex * PACKET_SIZE_BYTES);
            int endByte = Math.min(txBytes.length, startByte + (int) toRead * PACKET_SIZE_BYTES);

            byte[] outData = Arrays.copyOfRange(txBytes, startByte, endByte);

            int tsStart = (int) packetIndex;
            int tsEnd = Math.min(txTsMs.length, tsStart + (int) toRead);
            long[] outTs = tsStart < tsEnd ? Arrays.copyOfRange(txTsMs, tsStart, tsEnd) : new long[0];

            return new Object[] { outData, outTs, packetIndex + toRead, available };
        }
    }

    public static long getRxPacketCount() {
        synchronized (LOCK) {
            return rxBytes.length / (long) PACKET_SIZE_BYTES;
        }
    }

    public static long getRxCounter() {
        synchronized (LOCK) {
            return rxCounter;
        }
    }

    public static void setRxCounter(long value) {
        synchronized (LOCK) {
            long packets = rxBytes.length / (long) PACKET_SIZE_BYTES;
            long desired = Math.max(0, value);
            rxCounter = Math.min(desired, packets);
        }
    }

    // Returns Object[] { byte[] packet, long tsMs } or null.
    public static Object[] nextRxPacket() {
        synchronized (LOCK) {
            long packets = rxBytes.length / (long) PACKET_SIZE_BYTES;
            if (rxCounter >= packets) return null;

            int startByte = (int) (rxCounter * PACKET_SIZE_BYTES);
            if (startByte + PACKET_SIZE_BYTES > rxBytes.length) return null;

            byte[] pkt = Arrays.copyOfRange(rxBytes, startByte, startByte + PACKET_SIZE_BYTES);
            long ts = (rxCounter >= 0 && rxCounter < rxTsMs.length) ? rxTsMs[(int) rxCounter] : 0;
            rxCounter += 1;
            return new Object[] { pkt, ts };
        }
    }

    // Returns Object[] { float[] timeValues, float[] dataValues }.
    public static Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
        synchronized (LOCK) {
            int totalBits = rxBytes.length * 8;
            if (rxBytes.length == 0 || rangeStart >= rangeEnd || rangeStart >= totalBits || numberBins <= 0) {
                return new Object[] { new float[0], new float[0] };
            }

            int end = Math.min(rangeEnd, totalBits);
            int start = Math.min(rangeStart, end);
            int span = end - start;
            if (span <= 0) {
                return new Object[] { new float[0], new float[0] };
            }

            if (span <= numberBins * 2) {
                float[] t = new float[span];
                float[] v = new float[span];
                for (int i = 0; i < span; i++) {
                    int bitIndex = start + i;
                    t[i] = bitIndex;
                    v[i] = bitAt(rxBytes, bitIndex) == 1 ? 255f : 0f;
                }
                return new Object[] { t, v };
            }

            // Worst case: 2 points per bin.
            float[] tTmp = new float[numberBins * 2];
            float[] vTmp = new float[numberBins * 2];
            int outCount = 0;

            double binWidth = (double) span / (double) numberBins;
            for (int bin = 0; bin < numberBins; bin++) {
                int binStart = (int) Math.floor((double) start + (double) bin * binWidth);
                int binEnd = (int) Math.floor((double) binStart + binWidth);
                if (binEnd > end) binEnd = end;
                if (binEnd <= binStart) continue;

                boolean hasLow = false;
                boolean hasHigh = false;

                int i = binStart;
                while (i < binEnd) {
                    int byteIndex = i >> 3;
                    if (byteIndex >= rxBytes.length) break;

                    if ((i & 7) == 0 && i + 8 <= binEnd) {
                        int byteVal = rxBytes[byteIndex] & 0xFF;
                        if (byteVal == 0) {
                            hasLow = true;
                        } else if (byteVal == 255) {
                            hasHigh = true;
                        } else {
                            hasLow = true;
                            hasHigh = true;
                        }
                        i += 8;
                    } else {
                        if (bitAt(rxBytes, i) == 1) hasHigh = true; else hasLow = true;
                        i += 1;
                    }

                    if (hasLow && hasHigh) break;
                }

                if (hasLow || hasHigh) {
                    if (outCount + 2 > tTmp.length) break;
                    tTmp[outCount] = binStart;
                    vTmp[outCount] = hasLow ? 0f : 255f;
                    outCount++;
                    tTmp[outCount] = (binEnd - 1);
                    vTmp[outCount] = hasHigh ? 255f : 0f;
                    outCount++;
                }
            }

            float[] t = Arrays.copyOf(tTmp, outCount);
            float[] v = Arrays.copyOf(vTmp, outCount);
            return new Object[] { t, v };
        }
    }

    // Historical name: returns an 18B packet.
    public static byte[] makePacket64(byte[] data) {
        if (data == null) return null;
        if (data.length > PACKET_SIZE_BYTES) return null;
        byte[] out = new byte[PACKET_SIZE_BYTES];
        System.arraycopy(data, 0, out, 0, data.length);
        return out;
    }

    // Returns -1 when not a BS frame.
    public static int parseBsStatus(byte[] packet64) {
        if (packet64 == null || packet64.length < 4) return -1;
        if (packet64[0] != 'B' || packet64[1] != 'S') return -1;
        int hi = packet64[2] & 0xFF;
        int lo = packet64[3] & 0xFF;
        return (hi << 8) | lo;
    }

    // --- Transmit pacing (matches crates/emwaver-buffer-core/src/tx.rs) ---

    public static int[] txProfile() {
        return new int[] {
            240, // max_packet_size
            128, // min_packet_size
            188, // initial_packet_size
            15,  // fixed_delay_ms
            2048, // target_buffer_level
            3000, // buffer_high_threshold
            1000, // buffer_low_threshold
            2048, // initial_fill_bytes
            100,  // nudge_band
            32,   // step_large
            16,   // step_small
        };
    }

    public static int txNextPacketSize(int bytesSent, int lastStatus, int currentPacketSize) {
        int[] p = txProfile();
        int maxPacket = p[0];
        int minPacket = p[1];
        int initialPacket = p[2];
        int target = p[4];
        int high = p[5];
        int low = p[6];
        int initialFill = p[7];
        int nudgeBand = p[8];
        int stepLarge = p[9];
        int stepSmall = p[10];

        int sent = Math.max(0, bytesSent);
        int cur = Math.max(0, currentPacketSize);

        if (sent < initialFill) return maxPacket;

        if (lastStatus > high) return Math.max(minPacket, cur - stepLarge);
        if (lastStatus < low) return Math.min(maxPacket, cur + stepLarge);

        if (cur != initialPacket && Math.abs(lastStatus - target) < nudgeBand) {
            if (cur < initialPacket) return Math.min(initialPacket, cur + stepSmall);
            return Math.max(initialPacket, cur - stepSmall);
        }

        return cur;
    }

    public static int[] txUsbProfile() {
        // UsbTxProfile::default
        return new int[] {
            PACKET_SIZE_BYTES, // packet_size
            720_000,           // period_ns
            125_000,           // flow_time_delta_ns
            300,               // buffer_high_threshold
            200,               // buffer_low_threshold
        };
    }

    public static long txUsbAdjustDeadlineNs(long deadlineNs, int lastStatus) {
        int[] p = txUsbProfile();
        long flowDelta = p[2];
        int high = p[3];
        int low = p[4];

        if (lastStatus > high) return deadlineNs + flowDelta;
        if (lastStatus < low) return deadlineNs - flowDelta;
        return deadlineNs;
    }

    // Internal RX swap used during transmit.
    static Object[] takeRxState() {
        synchronized (LOCK) {
            return new Object[] { Arrays.copyOf(rxBytes, rxBytes.length), Arrays.copyOf(rxTsMs, rxTsMs.length), rxCounter };
        }
    }

    static void restoreRxState(byte[] rxBytesIn, long[] rxTsMsIn, long rxCounterIn) {
        synchronized (LOCK) {
            rxBytes = rxBytesIn != null ? Arrays.copyOf(rxBytesIn, rxBytesIn.length) : new byte[0];
            rxTsMs = rxTsMsIn != null ? Arrays.copyOf(rxTsMsIn, rxTsMsIn.length) : new long[0];

            int packets = rxBytes.length / PACKET_SIZE_BYTES;
            if (rxTsMs.length < packets) {
                rxTsMs = Arrays.copyOf(rxTsMs, packets);
            } else if (rxTsMs.length > packets) {
                rxTsMs = Arrays.copyOf(rxTsMs, packets);
            }

            long desired = Math.max(0, rxCounterIn);
            rxCounter = Math.min(desired, (long) packets);
        }
    }

    // Compatibility helper (previous Android call sites used clearBuffer).
    public static void clearBuffer() {
        clearAll();
    }

    // --- helpers ---

    private static int bitAt(byte[] buf, int bitIndex) {
        int byteIndex = bitIndex >> 3;
        if (byteIndex < 0 || byteIndex >= buf.length) return 0;
        int b = buf[byteIndex] & 0xFF;
        int shift = bitIndex & 7;
        return (b >> shift) & 1;
    }

    private static byte[] appendBytes(byte[] a, byte[] b) {
        if (b.length == 0) return a;
        if (a.length == 0) return Arrays.copyOf(b, b.length);
        byte[] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static long[] appendRepeated(long[] a, long value, int count) {
        if (count <= 0) return a;
        long[] out = Arrays.copyOf(a, a.length + count);
        for (int i = 0; i < count; i++) out[a.length + i] = value;
        return out;
    }
}
