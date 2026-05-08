/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import androidx.annotation.Nullable;

public interface ScriptDeviceBridge {
    int DEFAULT_PACKET_SIZE_BYTES = 18;

    boolean isConnected();

    @Nullable
    byte[] sendPacket(byte[] data, int timeoutMs);

    void transmitBuffer();

    void clearBuffer();

    int getBufferLength();

    @Nullable
    byte[] getBuffer();

    void loadBuffer(byte[] data);

    default int getBufferPacketSizeBytes() {
        return DEFAULT_PACKET_SIZE_BYTES;
    }
}
