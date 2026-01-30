using EMWaver.Services;

namespace EMWaver;

internal static class AppServices
{
    internal static readonly ScriptRepository Scripts = new();
    internal static readonly WindowsDeviceManager Device = new();
}
