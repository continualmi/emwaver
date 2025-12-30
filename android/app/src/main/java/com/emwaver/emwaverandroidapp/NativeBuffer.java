package com.emwaver.emwaverandroidapp;

public final class NativeBuffer {
    static {
        System.loadLibrary("native-lib");
    }

    private NativeBuffer() {}

    public static native void storeBulkPkt(byte[] data, long tsMs);
    public static native byte[] getCommand();
    public static native Object[] compressDataBits(int rangeStart, int rangeEnd, int numberBins);
    public static native int getStatusNumber();
    public static native void clearCommandBuffer();
    public static native void setCaptureMode(boolean enabled);
    public static native void clearBuffer();
    public static native int getBufferLength();
    public static native void loadBuffer(byte[] data);
    public static native byte[] getBuffer();
    public static native void invertBuffer();
    public static native void setCaptureInvert(boolean enabled);

    // Desktop-parity buffer monitor APIs (64B packets + per-packet timestamps).
    // Returns Object[] { byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets }.
    public static native Object[] readRxSince(long packetIndex, int maxPackets);
    public static native Object[] readTxSince(long packetIndex, int maxPackets);

    // Append outbound bytes to the TX log as padded 64B packets (one tsMs per 64B packet).
    public static native void appendTxBytes(byte[] data, long tsMs);
}
