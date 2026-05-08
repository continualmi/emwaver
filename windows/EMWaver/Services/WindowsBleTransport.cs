using System;

namespace EMWaver.Services;

internal static class WindowsBleTransport
{
    internal static readonly Guid ServiceUuid = Guid.Parse("45C7158E-0C3B-4E90-A847-452A15B14191");
    internal static readonly Guid CommandUuid = Guid.Parse("46C7158E-0C3B-4E90-A847-452A15B14191");
    internal static readonly Guid NotifyUuid = Guid.Parse("47C7158E-0C3B-4E90-A847-452A15B14191");

    internal const int WriteChunkBytes = 20;

    internal static string SessionId(ulong bluetoothAddress) => $"ble:{bluetoothAddress:X}";

    internal static bool MatchesAdvertisementName(string name)
    {
        return string.IsNullOrWhiteSpace(name) ||
               name.Contains("emwaver", StringComparison.OrdinalIgnoreCase);
    }
}
