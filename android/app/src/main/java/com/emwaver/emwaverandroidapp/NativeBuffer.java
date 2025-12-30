package com.emwaver.emwaverandroidapp;

public final class NativeBuffer {
    static {
        System.loadLibrary("native-lib");
    }

    private NativeBuffer() {}

    public static native void storeBulkPkt(byte[] data, long tsMs);
    public static native Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
    public static native int getStatusNumber();
    public static native void setCaptureMode(boolean enabled);
    public static native void clearBuffer();
    // Clears RX+TX logs and counters (desktop `buffer_clear` parity).
    public static native void clearAll();
    public static native int getBufferLength();
    public static native void loadBuffer(byte[] data);
    public static native byte[] getBuffer();
    public static native void invertBuffer();
    public static native void setCaptureInvert(boolean enabled);

    // Desktop-parity buffer monitor APIs (64B packets + per-packet timestamps).
    // Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
    public static native Object[] readRxSince(long packetIndex, int maxPackets);
    public static native Object[] readTxSince(long packetIndex, int maxPackets);

    // Desktop-parity command-response cursor APIs (rx_counter consumption).
    public static native long getRxPacketCount();
    public static native long getRxCounter();
    public static native void setRxCounter(long value);
    // Returns Object[] { byte[] packet64, long tsMs } or null if no packet available.
    public static native Object[] nextRxPacket();

    // RX state accessors for Java-side swap/restore flows (e.g., retransmit).
    public static native long[] getRxTimestampsMs();
    // Restores RX bytes + per-64B timestamps + rx_counter in one call (timestamps are clamped).
    public static native void setRxState(byte[] rxBytes, long[] rxTimestampsMs, long rxCounter);

    // Append outbound bytes to the TX log as padded 64B packets (one tsMs per 64B packet).
    public static native void appendTxBytes(byte[] data, long tsMs);
}
