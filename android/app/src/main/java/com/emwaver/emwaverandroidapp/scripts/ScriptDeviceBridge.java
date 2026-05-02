/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

import androidx.annotation.Nullable;

public interface ScriptDeviceBridge {
    boolean isConnected();

    @Nullable
    byte[] sendPacket(byte[] data, int timeoutMs);

    void transmitBuffer();

    void clearBuffer();

    int getBufferLength();

    @Nullable
    byte[] getBuffer();

    void loadBuffer(byte[] data);
}
