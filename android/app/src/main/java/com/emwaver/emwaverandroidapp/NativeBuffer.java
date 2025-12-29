package com.emwaver.emwaverandroidapp;

public final class NativeBuffer {
    static {
        System.loadLibrary("native-lib");
    }

    private NativeBuffer() {}

    public static native void storeBulkPkt(byte[] data);
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
}
