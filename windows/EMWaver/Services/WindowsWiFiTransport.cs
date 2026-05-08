namespace EMWaver.Services;

internal static class WindowsWiFiTransport
{
    internal const string TransportName = "Wi-Fi";

    internal sealed class Connection : ITransportDeviceConnection
    {
        internal Connection(string? hostOrDeviceId, ITransportDeviceSession? session = null)
        {
            HostOrDeviceId = string.IsNullOrWhiteSpace(hostOrDeviceId) ? "active" : hostOrDeviceId.Trim();
            SessionId = WindowsWiFiTransport.SessionId(HostOrDeviceId);
            DisplayName = WindowsWiFiTransport.DisplayName(HostOrDeviceId);
            Session = session ?? new DeviceBufferSession(SessionId);
        }

        internal string HostOrDeviceId { get; }
        public string SessionId { get; }
        public string DisplayName { get; }
        public ITransportDeviceSession Session { get; }
    }

    internal static string SessionId(string hostOrDeviceId)
    {
        var key = string.IsNullOrWhiteSpace(hostOrDeviceId) ? "active" : hostOrDeviceId.Trim();
        return $"wifi:{key}";
    }

    internal static string DisplayName(string hostOrDeviceId)
    {
        var key = string.IsNullOrWhiteSpace(hostOrDeviceId) ? "device" : hostOrDeviceId.Trim();
        return $"{TransportName}: {key}";
    }
}
