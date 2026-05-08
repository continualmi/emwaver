/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

interface TransportDeviceSession {
    String deviceId();
    void clearAll();
    int getBufferLength();
    void loadBuffer(byte[] data);
    byte[] getBuffer();
    void storeBulkPkt(byte[] data, long tsMs);
    void appendTxBytes(byte[] data, long tsMs);
    long getTxPacketCount();
    byte[] getTxBuffer();
    void updateSamplerStreamingState(byte[] lane);
    boolean shouldStoreStreamLane(byte[] streamLane);
    void resetSamplerStreaming();
    void feedSysexBytes(byte[] data, int offset, int count, long tsMs);
    void prepareCommandResponseWait();
    byte[] awaitCommandResponse(int timeoutMs);
    long getRxPacketCount();
    void setRxCounter(long value);
    Object[] nextRxPacket();
    Object[] takeRxState();
    void restoreRxState(byte[] rxBytesIn, long[] rxTsMsIn, long rxCounterIn);
    Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
}

interface TransportDeviceConnection {
    String sessionId();
    String displayName();
    TransportDeviceSession session();
}
