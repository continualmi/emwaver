namespace EMWaver.Services;

internal sealed class ActiveDeviceTarget
{
    internal static readonly ActiveDeviceTarget None = new("active", DeviceTransport.None);

    internal ActiveDeviceTarget(string deviceId, DeviceTransport transport)
    {
        DeviceId = string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim();
        Transport = transport;
    }

    internal string DeviceId { get; }
    internal DeviceTransport Transport { get; }

    internal bool MatchesDeviceId(string? deviceId)
    {
        var requested = string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim();
        return string.Equals(requested, DeviceId, StringComparison.OrdinalIgnoreCase);
    }

    internal bool MatchesTransport(DeviceTransport transport) => Transport == transport;
}
