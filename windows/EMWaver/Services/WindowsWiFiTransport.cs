using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal static class WindowsWiFiTransport
{
    internal const string TransportName = "Wi-Fi";
    internal const int DefaultPort = 3922;

    internal sealed class Connection : ITransportDeviceConnection, IDisposable
    {
        private readonly ClientWebSocket? _webSocket;
        private readonly CancellationTokenSource? _receiveCancellation;

        internal Connection(string? hostOrDeviceId, ITransportDeviceSession? session = null)
            : this(hostOrDeviceId, DefaultPort, session, null, null)
        {
        }

        internal Connection(
            string? host,
            int port,
            ITransportDeviceSession? session = null,
            ClientWebSocket? webSocket = null,
            CancellationTokenSource? receiveCancellation = null)
        {
            Host = string.IsNullOrWhiteSpace(host) ? "active" : host.Trim();
            Port = IsValidPort(port) ? port : DefaultPort;
            HostOrDeviceId = $"{Host}:{Port}";
            SessionId = WindowsWiFiTransport.SessionId(HostOrDeviceId);
            DisplayName = WindowsWiFiTransport.DisplayName(HostOrDeviceId);
            Session = session ?? new DeviceBufferSession(SessionId);
            _webSocket = webSocket;
            _receiveCancellation = receiveCancellation;
        }

        internal string HostOrDeviceId { get; }
        internal string Host { get; }
        internal int Port { get; }
        public string SessionId { get; }
        public string DisplayName { get; }
        public ITransportDeviceSession Session { get; }
        internal bool IsOpen => _webSocket?.State == WebSocketState.Open;

        internal async Task<string?> SendSysexAsync(byte[] sysex, CancellationToken cancellationToken = default)
        {
            if (_webSocket == null || _webSocket.State != WebSocketState.Open)
            {
                return "Wi-Fi WebSocket is not connected";
            }
            if (sysex == null || sysex.Length == 0)
            {
                return null;
            }

            await _webSocket.SendAsync(
                new ArraySegment<byte>(sysex),
                WebSocketMessageType.Binary,
                endOfMessage: true,
                cancellationToken);
            return null;
        }

        public void Dispose()
        {
            try
            {
                _receiveCancellation?.Cancel();
            }
            catch
            {
            }

            try
            {
                if (_webSocket != null)
                {
                    if (_webSocket.State == WebSocketState.Open || _webSocket.State == WebSocketState.CloseReceived)
                    {
                        _ = _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "EMWaver disconnect", CancellationToken.None);
                    }
                    _webSocket.Dispose();
                }
            }
            catch
            {
            }

            _receiveCancellation?.Dispose();
        }
    }

    internal static string SessionId(string? hostOrDeviceId)
    {
        var key = string.IsNullOrWhiteSpace(hostOrDeviceId) ? "active" : hostOrDeviceId.Trim();
        return $"wifi:{key}";
    }

    internal static string DisplayName(string? hostOrDeviceId)
    {
        var key = string.IsNullOrWhiteSpace(hostOrDeviceId) ? "device" : hostOrDeviceId.Trim();
        return $"{TransportName}: {key}";
    }

    internal static bool IsValidPort(int port) => port is >= 1 and <= 65535;

    internal static bool IsValidManualHost(string? host)
    {
        var value = string.IsNullOrWhiteSpace(host) ? string.Empty : host.Trim();
        return value.Length > 0
            && !value.Contains("://", StringComparison.Ordinal)
            && !value.Contains('/', StringComparison.Ordinal)
            && !value.Contains('?', StringComparison.Ordinal)
            && !value.Contains('#', StringComparison.Ordinal)
            && !value.Contains('@', StringComparison.Ordinal)
            && !value.Contains('[', StringComparison.Ordinal)
            && !value.Contains(']', StringComparison.Ordinal)
            && !value.Contains(' ', StringComparison.Ordinal)
            && !value.Contains('\t', StringComparison.Ordinal);
    }

    internal static Uri? WebSocketUri(string? host, int port)
    {
        if (!IsValidManualHost(host) || !IsValidPort(port))
        {
            return null;
        }

        var safeHost = host!.Trim();
        var uriHost = safeHost.Contains(':', StringComparison.Ordinal) ? $"[{safeHost}]" : safeHost;
        return new Uri($"ws://{uriHost}:{port}/v1/ws");
    }

    internal static async Task<Connection> OpenConnectionAsync(
        string host,
        int port,
        Action<byte[]> onBytes,
        ITransportDeviceSession? session = null,
        CancellationToken cancellationToken = default)
    {
        var uri = WebSocketUri(host, port) ?? throw new ArgumentException("Invalid Wi-Fi host or port");
        var webSocket = new ClientWebSocket();
        await webSocket.ConnectAsync(uri, cancellationToken);

        var receiveCancellation = new CancellationTokenSource();
        var connection = new Connection(host, port, session, webSocket, receiveCancellation);
        _ = Task.Run(
            () => ReceiveLoopAsync(webSocket, onBytes, receiveCancellation.Token),
            CancellationToken.None);
        return connection;
    }

    private static async Task ReceiveLoopAsync(
        ClientWebSocket webSocket,
        Action<byte[]> onBytes,
        CancellationToken cancellationToken)
    {
        try
        {
            var buffer = new byte[4096];
            while (!cancellationToken.IsCancellationRequested && webSocket.State == WebSocketState.Open)
            {
                using var message = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return;
                    }
                    if (result.Count > 0)
                    {
                        message.Write(buffer, 0, result.Count);
                    }
                }
                while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Binary && message.Length > 0)
                {
                    onBytes(message.ToArray());
                }
                else if (result.MessageType == WebSocketMessageType.Text && message.Length > 0)
                {
                    var text = Encoding.UTF8.GetString(message.ToArray());
                    if (text.Contains("busy", StringComparison.OrdinalIgnoreCase))
                    {
                        return;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
        }
    }
}
