/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

final class DeviceBufferSession implements TransportDeviceSession {
    private static final int PACKET_SIZE_BYTES = 18;
    private static final int EMW_OP_SAMPLE = 0x60;
    private static final int EMW_SAMPLE_START = 0x00;
    private static final int EMW_SAMPLE_STOP = 0x01;

    private byte[] rxBytes = new byte[0];
    private long[] rxTsMs = new long[0];
    private long rxCounter = 0;
    private byte[] txBytes = new byte[0];
    private long[] txTsMs = new long[0];
    private boolean samplerStreamingActive = false;
    private final ByteArrayOutputStream sysexBuf = new ByteArrayOutputStream(64);
    private boolean inSysex = false;
    private final String deviceId;

    DeviceBufferSession() {
        this("active");
    }

    DeviceBufferSession(String deviceId) {
        this.deviceId = deviceId == null || deviceId.trim().isEmpty() ? "active" : deviceId.trim();
    }

    @Override
    public String deviceId() {
        return deviceId;
    }

    @Override
    public synchronized void clearAll() {
        rxBytes = new byte[0];
        rxTsMs = new long[0];
        rxCounter = 0;
        txBytes = new byte[0];
        txTsMs = new long[0];
        samplerStreamingActive = false;
        sysexBuf.reset();
        inSysex = false;
    }

    @Override
    public synchronized int getBufferLength() {
        return rxBytes.length;
    }

    @Override
    public synchronized void loadBuffer(byte[] data) {
        rxBytes = data != null ? Arrays.copyOf(data, data.length) : new byte[0];
        rxCounter = 0;
        int packets = rxBytes.length / PACKET_SIZE_BYTES;
        rxTsMs = new long[packets];
    }

    @Override
    public synchronized byte[] getBuffer() {
        return Arrays.copyOf(rxBytes, rxBytes.length);
    }

    @Override
    public synchronized void storeBulkPkt(byte[] data, long tsMs) {
        if (data == null || data.length == 0) return;

        int prevPackets = rxBytes.length / PACKET_SIZE_BYTES;
        rxBytes = appendBytes(rxBytes, data);
        int newPackets = rxBytes.length / PACKET_SIZE_BYTES;
        int delta = Math.max(0, newPackets - prevPackets);
        if (delta > 0) {
            rxTsMs = appendRepeated(rxTsMs, tsMs, delta);
        }
    }

    @Override
    public synchronized void appendTxBytes(byte[] data, long tsMs) {
        if (data == null || data.length == 0) return;

        for (int offset = 0; offset < data.length; offset += PACKET_SIZE_BYTES) {
            int take = Math.min(PACKET_SIZE_BYTES, data.length - offset);
            byte[] pkt = new byte[PACKET_SIZE_BYTES];
            System.arraycopy(data, offset, pkt, 0, take);
            txBytes = appendBytes(txBytes, pkt);
            txTsMs = appendRepeated(txTsMs, tsMs, 1);
        }
    }

    @Override
    public synchronized long getTxPacketCount() {
        return txTsMs.length;
    }

    @Override
    public synchronized byte[] getTxBuffer() {
        return Arrays.copyOf(txBytes, txBytes.length);
    }

    @Override
    public synchronized void updateSamplerStreamingState(byte[] lane) {
        if (lane == null || lane.length < 2) {
            return;
        }
        int opcode = lane[0] & 0xFF;
        if (opcode != EMW_OP_SAMPLE) {
            return;
        }
        int sub = lane[1] & 0xFF;
        if (sub == EMW_SAMPLE_START) {
            samplerStreamingActive = true;
        } else if (sub == EMW_SAMPLE_STOP) {
            samplerStreamingActive = false;
        }
    }

    @Override
    public synchronized boolean shouldStoreStreamLane(byte[] streamLane) {
        return !isLaneEmpty(streamLane) || samplerStreamingActive;
    }

    @Override
    public synchronized void resetSamplerStreaming() {
        samplerStreamingActive = false;
    }

    @Override
    public synchronized void feedSysexBytes(byte[] data, int offset, int count, long tsMs) {
        if (data == null || count <= 0) {
            return;
        }

        int end = Math.min(data.length, offset + count);
        for (int i = Math.max(0, offset); i < end; i++) {
            byte b = data[i];
            if (b == (byte) 0xF0) {
                sysexBuf.reset();
                inSysex = true;
            }
            if (!inSysex) {
                continue;
            }
            sysexBuf.write(b);
            if (sysexBuf.size() > 128) {
                sysexBuf.reset();
                inSysex = false;
                continue;
            }
            if (b == (byte) 0xF7) {
                inSysex = false;
                byte[] sysex = sysexBuf.toByteArray();
                sysexBuf.reset();

                byte[] frame = UsbMidiSysex.decodeSysexToFrame(sysex);
                if (frame == null || frame.length != UsbMidiSysex.FRAME_SIZE) {
                    continue;
                }

                byte[] cmdLane = Arrays.copyOfRange(frame, 0, UsbMidiSysex.LANE_SIZE);
                byte[] streamLane = Arrays.copyOfRange(frame, UsbMidiSysex.LANE_SIZE, UsbMidiSysex.FRAME_SIZE);

                if (!isLaneEmpty(cmdLane)) {
                    storeBulkPkt(cmdLane, tsMs);
                }
                if (shouldStoreStreamLane(streamLane)) {
                    storeBulkPkt(streamLane, tsMs);
                }
            }
        }
    }

    @Override
    public synchronized void prepareCommandResponseWait() {
        rxCounter = rxBytes.length / (long) PACKET_SIZE_BYTES;
    }

    @Override
    public byte[] awaitCommandResponse(int timeoutMs) {
        long startTime = System.currentTimeMillis();
        int safeTimeout = Math.max(1, timeoutMs);
        while (System.currentTimeMillis() - startTime < safeTimeout) {
            byte[] pkt = nextRxPacketData();
            if (pkt != null && pkt.length >= PACKET_SIZE_BYTES) {
                int status = pkt[0] & 0xFF;
                if (status >= 0x80) {
                    return Arrays.copyOf(pkt, PACKET_SIZE_BYTES);
                }
            }
            try {
                Thread.sleep(5);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        return null;
    }

    @Override
    public synchronized long getRxPacketCount() {
        return rxBytes.length / (long) PACKET_SIZE_BYTES;
    }

    @Override
    public synchronized void setRxCounter(long value) {
        long packets = rxBytes.length / (long) PACKET_SIZE_BYTES;
        long desired = Math.max(0, value);
        rxCounter = Math.min(desired, packets);
    }

    @Override
    public synchronized Object[] nextRxPacket() {
        byte[] pkt = nextRxPacketDataLocked();
        if (pkt == null) return null;
        long ts = rxCounter > 0 && rxCounter - 1 < rxTsMs.length ? rxTsMs[(int) rxCounter - 1] : 0;
        return new Object[] { pkt, ts };
    }

    private synchronized byte[] nextRxPacketData() {
        return nextRxPacketDataLocked();
    }

    private byte[] nextRxPacketDataLocked() {
        long packets = rxBytes.length / (long) PACKET_SIZE_BYTES;
        if (rxCounter >= packets) return null;

        int startByte = (int) (rxCounter * PACKET_SIZE_BYTES);
        if (startByte + PACKET_SIZE_BYTES > rxBytes.length) return null;

        byte[] pkt = Arrays.copyOfRange(rxBytes, startByte, startByte + PACKET_SIZE_BYTES);
        rxCounter += 1;
        return pkt;
    }

    @Override
    public synchronized Object[] takeRxState() {
        return new Object[] { Arrays.copyOf(rxBytes, rxBytes.length), Arrays.copyOf(rxTsMs, rxTsMs.length), rxCounter };
    }

    @Override
    public synchronized void restoreRxState(byte[] rxBytesIn, long[] rxTsMsIn, long rxCounterIn) {
        rxBytes = rxBytesIn != null ? Arrays.copyOf(rxBytesIn, rxBytesIn.length) : new byte[0];
        rxTsMs = rxTsMsIn != null ? Arrays.copyOf(rxTsMsIn, rxTsMsIn.length) : new long[0];

        int packets = rxBytes.length / PACKET_SIZE_BYTES;
        if (rxTsMs.length != packets) {
            rxTsMs = Arrays.copyOf(rxTsMs, packets);
        }

        long desired = Math.max(0, rxCounterIn);
        rxCounter = Math.min(desired, (long) packets);
    }

    @Override
    public synchronized Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins) {
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

        return new Object[] { Arrays.copyOf(tTmp, outCount), Arrays.copyOf(vTmp, outCount) };
    }

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

    private static boolean isLaneEmpty(byte[] lane) {
        if (lane == null || lane.length == 0) return true;
        for (byte b : lane) {
            if (b != 0) return false;
        }
        return true;
    }
}
