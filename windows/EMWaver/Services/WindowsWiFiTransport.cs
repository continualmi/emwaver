namespace EMWaver.Services;

internal static class WindowsWiFiTransport
{
    internal const string TransportName = "Wi-Fi";

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
