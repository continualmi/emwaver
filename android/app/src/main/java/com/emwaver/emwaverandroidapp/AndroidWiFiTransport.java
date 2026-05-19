/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import androidx.annotation.Nullable;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

final class AndroidWiFiTransport {
    static final String TRANSPORT_NAME = "Wi-Fi";
    static final int DEFAULT_PORT = 3922;
    private static final byte WIFI_CONFIG_OPCODE = 0x0A;
    private static final byte WIFI_BEGIN = 0x00;
    private static final byte WIFI_FIELD = 0x01;
    private static final byte WIFI_APPLY = 0x02;
    private static final byte WIFI_CLEAR = 0x03;
    private static final byte WIFI_STATUS = 0x04;
    private static final byte WIFI_FIELD_SSID = 0x00;
    private static final byte WIFI_FIELD_PASSWORD = 0x01;
    private static final int COMMAND_CHUNK_BYTES = 13;
    private static final int MAX_SSID_BYTES = 32;
    private static final int MAX_PASSWORD_BYTES = 64;

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

    @Nullable
    static List<byte[]> provisioningCommands(String ssid, String password) {
        String trimmedSsid = ssid != null ? ssid.trim() : "";
        if (trimmedSsid.isEmpty()) {
            return null;
        }

        byte[] ssidBytes = trimmedSsid.getBytes(StandardCharsets.UTF_8);
        byte[] passwordBytes = (password != null ? password : "").getBytes(StandardCharsets.UTF_8);
        if (ssidBytes.length > MAX_SSID_BYTES || passwordBytes.length > MAX_PASSWORD_BYTES) {
            return null;
        }

        List<byte[]> commands = new ArrayList<>();
        commands.add(new byte[] { WIFI_CONFIG_OPCODE, WIFI_BEGIN });
        commands.addAll(fieldCommands(WIFI_FIELD_SSID, ssidBytes));
        commands.addAll(fieldCommands(WIFI_FIELD_PASSWORD, passwordBytes));
        commands.add(new byte[] { WIFI_CONFIG_OPCODE, WIFI_APPLY });
        return commands;
    }

    static byte[] clearProvisioningCommand() {
        return new byte[] { WIFI_CONFIG_OPCODE, WIFI_CLEAR };
    }

    static byte[] statusCommand() {
        return new byte[] { WIFI_CONFIG_OPCODE, WIFI_STATUS };
    }

    static boolean isOkResponse(@Nullable byte[] response) {
        return response != null && response.length > 0 && response[0] == (byte) 0x80;
    }

    @Nullable
    static String statusMessage(@Nullable byte[] response) {
        if (response == null || response.length < 3 || response[0] != (byte) 0x80) {
            return null;
        }

        String provisionedText = response[1] == 0 ? "unprovisioned" : "provisioned";
        String socketText = response[2] == 0 ? "idle" : "connected";
        if (response.length < 4) {
            return "Wi-Fi is " + provisionedText + "; socket is " + socketText + ".";
        }

        String stationText = response[3] == 0 ? "offline" : "online";
        if (response.length < 5) {
            return "Wi-Fi is " + provisionedText + ", station is " + stationText + "; socket is " + socketText + ".";
        }

        String retryText = response[4] == 0 ? "idle" : "retrying";
        if (response.length < 7) {
            return "Wi-Fi is " + provisionedText + ", station is " + stationText + " (" + retryText + "); socket is " + socketText + ".";
        }

        int reason = (response[5] & 0xFF) | ((response[6] & 0xFF) << 8);
        String reasonText = disconnectReasonText(reason);
        String runtimeText = response.length >= 13 && response[12] != 0 ? "running" : "idle";
        String ipText = stationIp(response);
        if (ipText != null) {
            return "Wi-Fi is " + provisionedText + ", station is " + stationText + " at " + ipText + " (" + retryText + ", " + reasonText + "); socket is " + socketText + "; runtime is " + runtimeText + ".";
        }
        return "Wi-Fi is " + provisionedText + ", station is " + stationText + " (" + retryText + ", " + reasonText + "); socket is " + socketText + "; runtime is " + runtimeText + ".";
    }

    private static List<byte[]> fieldCommands(byte field, byte[] bytes) {
        List<byte[]> commands = new ArrayList<>();
        for (int offset = 0; offset < bytes.length; offset += COMMAND_CHUNK_BYTES) {
            int count = Math.min(COMMAND_CHUNK_BYTES, bytes.length - offset);
            byte[] command = new byte[5 + count];
            command[0] = WIFI_CONFIG_OPCODE;
            command[1] = WIFI_FIELD;
            command[2] = field;
            command[3] = (byte) offset;
            command[4] = (byte) count;
            System.arraycopy(bytes, offset, command, 5, count);
            commands.add(command);
        }
        return commands;
    }

    @Nullable
    private static String stationIp(byte[] response) {
        if (response.length < 12 || response[7] == 0) {
            return null;
        }
        return (response[8] & 0xFF) + "." + (response[9] & 0xFF) + "." + (response[10] & 0xFF) + "." + (response[11] & 0xFF);
    }

    private static String disconnectReasonText(int reason) {
        switch (reason) {
            case 0:
                return "no disconnect reason";
            case 2:
                return "auth expired";
            case 15:
                return "4-way handshake timeout";
            case 201:
                return "no access point";
            case 202:
                return "auth failed";
            case 203:
                return "association failed";
            case 204:
                return "handshake timeout";
            case 205:
                return "connection failed";
            default:
                return "reason " + reason;
        }
    }

    private static String normalizeKey(@Nullable String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
