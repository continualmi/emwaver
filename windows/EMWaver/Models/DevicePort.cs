namespace EMWaver.Models;

public sealed record DevicePort(
    string DisplayName,
    string InDeviceId,
    string OutDeviceId
);
