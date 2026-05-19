using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal static class WindowsWiFiTransport
{
    internal const string TransportName = "Wi-Fi";
    internal const int DefaultPort = 3922;
    internal const string ServiceType = "_emwaver._tcp";
    private const byte WifiConfigOpcode = 0x0A;
    private const byte WifiBegin = 0x00;
    private const byte WifiField = 0x01;
    private const byte WifiApply = 0x02;
    private const byte WifiClear = 0x03;
    private const byte WifiStatus = 0x04;
    private const byte WifiFieldSsid = 0x00;
    private const byte WifiFieldPassword = 0x01;
    private const int CommandChunkBytes = 13;
    private const int MaxSsidBytes = 32;
    private const int MaxPasswordBytes = 64;

    internal sealed record DiscoveredDevice(
        string Id,
        string DisplayName,
        string Host,
        int Port,
        string? BoardType,
        string? FirmwareVersion,
        string? ProtocolVersion,
        IReadOnlyList<string> Capabilities);

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

    internal static DiscoveredDevice? DiscoveredDeviceFromDnsSd(
        string instanceName,
        string? hostName,
        int port,
        IReadOnlyDictionary<string, string>? metadata)
    {
        var host = NormalizeBonjourHost(metadata?.GetValueOrDefault("host") ?? hostName ?? instanceName);
        if (host == null)
        {
            return null;
        }

        var safePort = IsValidPort(port) ? port : DefaultPort;
        var capabilities = Capabilities(metadata?.GetValueOrDefault("cap"));
        return new DiscoveredDevice(
            SessionId($"{host}:{safePort}"),
            string.IsNullOrWhiteSpace(instanceName) ? host : instanceName.Trim(),
            host,
            safePort,
            NormalizeBoardType(metadata?.GetValueOrDefault("board")),
            NonEmpty(metadata?.GetValueOrDefault("fw")),
            NonEmpty(metadata?.GetValueOrDefault("proto")) ?? "1",
            capabilities.Count > 0 ? capabilities : new[] { "wifi" });
    }

    internal static IReadOnlyDictionary<string, string> ParseTextAttributes(object? value)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (value is null)
        {
            return result;
        }

        if (value is IEnumerable<string> lines)
        {
            foreach (var line in lines)
            {
                AddTextAttribute(result, line);
            }
            return result;
        }

        if (value is string lineValue)
        {
            AddTextAttribute(result, lineValue);
        }
        return result;
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

    internal static IReadOnlyList<byte[]>? ProvisioningCommands(string ssid, string password)
    {
        var trimmedSsid = ssid.Trim();
        if (string.IsNullOrWhiteSpace(trimmedSsid))
        {
            return null;
        }

        var ssidBytes = Encoding.UTF8.GetBytes(trimmedSsid);
        var passwordBytes = Encoding.UTF8.GetBytes(password);
        if (ssidBytes.Length > MaxSsidBytes || passwordBytes.Length > MaxPasswordBytes)
        {
            return null;
        }

        var commands = new List<byte[]> { new byte[] { WifiConfigOpcode, WifiBegin } };
        commands.AddRange(FieldCommands(WifiFieldSsid, ssidBytes));
        commands.AddRange(FieldCommands(WifiFieldPassword, passwordBytes));
        commands.Add(new byte[] { WifiConfigOpcode, WifiApply });
        return commands;
    }

    internal static byte[] ClearProvisioningCommand() => new byte[] { WifiConfigOpcode, WifiClear };

    internal static byte[] StatusCommand() => new byte[] { WifiConfigOpcode, WifiStatus };

    internal static bool IsOkResponse(byte[]? response) => response is { Length: > 0 } && response[0] == 0x80;

    internal static string? StatusMessage(byte[]? response)
    {
        if (response is not { Length: >= 3 } || response[0] != 0x80)
        {
            return null;
        }

        var provisionedText = response[1] == 0 ? "unprovisioned" : "provisioned";
        var socketText = response[2] == 0 ? "idle" : "connected";
        if (response.Length < 4)
        {
            return $"Wi-Fi is {provisionedText}; socket is {socketText}.";
        }

        var stationText = response[3] == 0 ? "offline" : "online";
        if (response.Length < 5)
        {
            return $"Wi-Fi is {provisionedText}, station is {stationText}; socket is {socketText}.";
        }

        var retryText = response[4] == 0 ? "idle" : "retrying";
        if (response.Length < 7)
        {
            return $"Wi-Fi is {provisionedText}, station is {stationText} ({retryText}); socket is {socketText}.";
        }

        var reason = (ushort)(response[5] | (response[6] << 8));
        var reasonText = DisconnectReasonText(reason);
        var runtimeText = response.Length >= 13 && response[12] != 0 ? "running" : "idle";
        var ipText = StationIp(response);
        return ipText != null
            ? $"Wi-Fi is {provisionedText}, station is {stationText} at {ipText} ({retryText}, {reasonText}); socket is {socketText}; runtime is {runtimeText}."
            : $"Wi-Fi is {provisionedText}, station is {stationText} ({retryText}, {reasonText}); socket is {socketText}; runtime is {runtimeText}.";
    }

    private static IEnumerable<byte[]> FieldCommands(byte field, byte[] bytes)
    {
        if (bytes.Length == 0)
        {
            yield break;
        }

        var offset = 0;
        while (offset < bytes.Length)
        {
            var count = Math.Min(CommandChunkBytes, bytes.Length - offset);
            var command = new byte[5 + count];
            command[0] = WifiConfigOpcode;
            command[1] = WifiField;
            command[2] = field;
            command[3] = (byte)offset;
            command[4] = (byte)count;
            Array.Copy(bytes, offset, command, 5, count);
            yield return command;
            offset += count;
        }
    }

    private static string? StationIp(byte[] response)
    {
        if (response.Length < 12 || response[7] == 0)
        {
            return null;
        }
        return $"{response[8]}.{response[9]}.{response[10]}.{response[11]}";
    }

    private static string? NormalizeBonjourHost(string? value)
    {
        var host = NonEmpty(value);
        if (host == null || host.Any(char.IsWhiteSpace))
        {
            return null;
        }
        if (host.EndsWith(".local.", StringComparison.OrdinalIgnoreCase))
        {
            host = host[..^1];
        }
        else if (!host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            host += ".local";
        }
        return IsValidManualHost(host) ? host : null;
    }

    private static string? NormalizeBoardType(string? value)
    {
        var text = NonEmpty(value);
        return text?.ToLowerInvariant() switch
        {
            "esp32s3" or "esp32-s3" => "esp32s3",
            "esp32s2" or "esp32-s2" => "esp32s2",
            "esp32" => "esp32",
            _ => text,
        };
    }

    private static string? NonEmpty(string? value)
    {
        var trimmed = value?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static IReadOnlyList<string> Capabilities(string? value)
    {
        return NonEmpty(value)?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(item => item.ToLowerInvariant())
            .Where(item => item.Length > 0)
            .ToArray() ?? Array.Empty<string>();
    }

    private static void AddTextAttribute(IDictionary<string, string> result, string? line)
    {
        var text = NonEmpty(line);
        if (text == null)
        {
            return;
        }
        var separator = text.IndexOf('=');
        if (separator <= 0 || separator == text.Length - 1)
        {
            return;
        }
        result[text[..separator]] = text[(separator + 1)..];
    }

    private static string DisconnectReasonText(ushort reason)
    {
        return reason switch
        {
            0 => "no disconnect reason",
            2 => "auth expired",
            15 => "4-way handshake timeout",
            201 => "no access point",
            202 => "auth failed",
            203 => "association failed",
            204 => "handshake timeout",
            205 => "connection failed",
            _ => $"reason {reason}",
        };
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
