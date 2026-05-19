/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.util.Log;

import androidx.annotation.Nullable;

import okhttp3.OkHttpClient;

final class AndroidWiFiProtocol {
    private static final String TAG = "AndroidWiFiProtocol";

    private final USBService host;
    private final Object lock = new Object();

    private volatile AndroidWiFiTransport.Connection connection;
    private OkHttpClient client;

    AndroidWiFiProtocol(USBService host) {
        this.host = host;
    }

    boolean hasOpenConnection() {
        AndroidWiFiTransport.Connection active = connection;
        return active != null && active.isOpen();
    }

    @Nullable
    String connectedLabel() {
        AndroidWiFiTransport.Connection active = connection;
        return active != null ? active.displayName() : null;
    }

    void connect(String hostName, int port) {
        String trimmedHost = hostName == null ? "" : hostName.trim();
        int safePort = AndroidWiFiTransport.isValidPort(port) ? port : AndroidWiFiTransport.DEFAULT_PORT;
        if (!AndroidWiFiTransport.isValidManualHost(trimmedHost)) {
            host.showToast("Wi-Fi host must be a hostname or IP address");
            return;
        }
        if (client == null) {
            client = new OkHttpClient();
        }

        final String sessionId = AndroidWiFiTransport.sessionId(trimmedHost + ":" + safePort);
        final TransportDeviceSession session;
        final AndroidWiFiTransport.Connection nextConnection;
        host.closeUsbTransport();
        host.closeBleTransport();
        synchronized (lock) {
            closeLocked();
            session = host.setActiveDeviceTarget(sessionId, ActiveTransport.WIFI);
            nextConnection = AndroidWiFiTransport.createConnection(trimmedHost, safePort, session);
            connection = nextConnection;
            host.setActiveConnection(connection);
        }

        try {
            AndroidWiFiTransport.openConnection(
                    client,
                    nextConnection,
                    new AndroidWiFiTransport.Listener() {
                        @Override
                        public void onOpen(AndroidWiFiTransport.Connection openedConnection) {
                            synchronized (lock) {
                                if (connection == openedConnection) {
                                    host.setActiveConnection(openedConnection);
                                }
                            }
                            host.showToast("Wi-Fi Connected!");
                            host.queryFirmwareVersionAsync();
                        }

                        @Override
                        public void onBytes(AndroidWiFiTransport.Connection openedConnection, byte[] data) {
                            host.feedSysexBytes(data, 0, data.length, session);
                        }

                        @Override
                        public void onText(AndroidWiFiTransport.Connection openedConnection, String text) {
                            if (text != null && text.toLowerCase().contains("busy")) {
                                host.showToast("Wi-Fi device is busy");
                                disconnect(openedConnection);
                            }
                        }

                        @Override
                        public void onClosed(AndroidWiFiTransport.Connection openedConnection) {
                            disconnect(openedConnection);
                        }

                        @Override
                        public void onFailure(AndroidWiFiTransport.Connection openedConnection, Throwable throwable) {
                            Log.e(TAG, "Wi-Fi transport failed", throwable);
                            host.showToast("Wi-Fi connection failed");
                            disconnect(openedConnection);
                        }
                    });
        } catch (RuntimeException e) {
            Log.e(TAG, "Wi-Fi transport failed to open", e);
            host.showToast("Wi-Fi connection failed");
            disconnect(nextConnection);
            return;
        }
        host.showToast("Opening Wi-Fi connection...");
    }

    void close() {
        synchronized (lock) {
            closeLocked();
        }
    }

    private void closeLocked() {
        AndroidWiFiTransport.Connection active = connection;
        connection = null;
        if (active != null) {
            active.close();
        }
        host.clearActiveDeviceTarget(ActiveTransport.WIFI);
    }

    private void disconnect(AndroidWiFiTransport.Connection closedConnection) {
        synchronized (lock) {
            if (connection == closedConnection) {
                closedConnection.markDisconnected();
                connection = null;
                host.clearActiveDeviceTarget(ActiveTransport.WIFI);
            }
        }
    }

    void writeSysex(byte[] sysex) {
        synchronized (lock) {
            AndroidWiFiTransport.Connection active = connection;
            if (active == null || !active.isOpen()) {
                host.showToast("No Wi-Fi device connected");
                return;
            }
            if (!active.sendSysex(sysex)) {
                host.showToast("Wi-Fi write failed");
            }
        }
    }
}
