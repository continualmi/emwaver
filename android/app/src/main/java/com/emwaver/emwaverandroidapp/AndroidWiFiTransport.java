/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import androidx.annotation.Nullable;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

final class AndroidWiFiTransport {
    static final String TRANSPORT_NAME = "Wi-Fi";
    static final int DEFAULT_PORT = 3922;

    private AndroidWiFiTransport() {}

    interface Listener {
        void onOpen(Connection connection);
        void onBytes(Connection connection, byte[] data);
        void onText(Connection connection, String text);
        void onClosed(Connection connection);
        void onFailure(Connection connection, Throwable throwable);
    }

    static final class Connection implements TransportDeviceConnection {
        final String hostOrDeviceId;
        final String host;
        final int port;
        final String sessionId;
        final String displayName;
        final TransportDeviceSession session;
        private volatile WebSocket webSocket;
        private volatile boolean connected;

        Connection(@Nullable String hostOrDeviceId) {
            this(hostOrDeviceId, null);
        }

        Connection(@Nullable String hostOrDeviceId, @Nullable TransportDeviceSession session) {
            this(hostOrDeviceId, DEFAULT_PORT, session, null);
        }

        Connection(@Nullable String host, int port, @Nullable TransportDeviceSession session, @Nullable WebSocket webSocket) {
            String safeHost = normalizeKey(host, "active");
            int safePort = isValidPort(port) ? port : DEFAULT_PORT;
            String key = safeHost + ":" + safePort;
            this.hostOrDeviceId = key;
            this.host = safeHost;
            this.port = safePort;
            this.sessionId = AndroidWiFiTransport.sessionId(key);
            this.displayName = AndroidWiFiTransport.displayName(key);
            this.session = session != null ? session : new DeviceBufferSession(this.sessionId);
            this.webSocket = webSocket;
        }

        @Override
        public String sessionId() {
            return sessionId;
        }

        @Override
        public String displayName() {
            return displayName;
        }

        @Override
        public TransportDeviceSession session() {
            return session;
        }

        boolean isOpen() {
            return connected && webSocket != null;
        }

        void attachWebSocket(WebSocket webSocket) {
            this.webSocket = webSocket;
        }

        void markConnected() {
            connected = true;
        }

        void markDisconnected() {
            connected = false;
        }

        boolean sendSysex(byte[] sysex) {
            return isOpen() && sysex != null && webSocket.send(okio.ByteString.of(sysex));
        }

        void close() {
            markDisconnected();
            if (webSocket != null) {
                webSocket.close(1000, "EMWaver disconnect");
            }
        }
    }

    static String sessionId(@Nullable String hostOrDeviceId) {
        String key = normalizeKey(hostOrDeviceId, "active");
        return "wifi:" + key;
    }

    static String displayName(@Nullable String hostOrDeviceId) {
        String key = normalizeKey(hostOrDeviceId, "device");
        return TRANSPORT_NAME + ": " + key;
    }

    static boolean isValidPort(int port) {
        return port >= 1 && port <= 65535;
    }

    static boolean isValidManualHost(@Nullable String host) {
        String value = normalizeKey(host, "");
        return !value.isEmpty()
                && !value.contains("://")
                && !value.contains("/")
                && !value.contains("?")
                && !value.contains("#")
                && !value.contains("@")
                && !value.matches(".*\\s+.*");
    }

    @Nullable
    static String webSocketUrl(@Nullable String host, int port) {
        if (!isValidManualHost(host) || !isValidPort(port)) {
            return null;
        }
        String safeHost = normalizeKey(host, "");
        String urlHost = safeHost.contains(":") ? "[" + safeHost + "]" : safeHost;
        return "ws://" + urlHost + ":" + port + "/v1/ws";
    }

    static WebSocket openWebSocket(OkHttpClient client, String host, int port, WebSocketListener listener) {
        String url = webSocketUrl(host, port);
        if (url == null) {
            throw new IllegalArgumentException("Invalid Wi-Fi host or port");
        }
        Request request = new Request.Builder().url(url).build();
        return client.newWebSocket(request, listener);
    }

    static Connection openConnection(
            OkHttpClient client,
            String host,
            int port,
            TransportDeviceSession session,
            Listener listener
    ) {
        Connection connection = createConnection(host, port, session);
        openConnection(client, connection, listener);
        return connection;
    }

    static Connection createConnection(String host, int port, TransportDeviceSession session) {
        if (webSocketUrl(host, port) == null) {
            throw new IllegalArgumentException("Invalid Wi-Fi host or port");
        }
        return new Connection(host, port, session, null);
    }

    static void openConnection(
            OkHttpClient client,
            Connection connection,
            Listener listener
    ) {
        String url = webSocketUrl(connection.host, connection.port);
        if (url == null) {
            throw new IllegalArgumentException("Invalid Wi-Fi host or port");
        }
        Request request = new Request.Builder().url(url).build();
        WebSocket webSocket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                connection.markConnected();
                if (listener != null) {
                    listener.onOpen(connection);
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                if (listener != null) {
                    listener.onBytes(connection, bytes.toByteArray());
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                if (listener != null) {
                    listener.onText(connection, text);
                }
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                connection.markDisconnected();
                if (listener != null) {
                    listener.onClosed(connection);
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, @Nullable Response response) {
                connection.markDisconnected();
                if (listener != null) {
                    listener.onFailure(connection, t);
                }
            }
        });
        connection.attachWebSocket(webSocket);
    }

    private static String normalizeKey(@Nullable String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
