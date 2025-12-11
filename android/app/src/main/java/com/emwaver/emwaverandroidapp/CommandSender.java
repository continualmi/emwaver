package com.emwaver.emwaverandroidapp;

public interface CommandSender {
    byte[] sendCommandAndGetResponse(byte[] command, int expectedResponseSize, int busyDelay, long timeoutMillis);
}
