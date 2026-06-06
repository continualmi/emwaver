using EMWaver.Services;
using EMWaver.Scripting;
using System.Net.Http;

namespace EMWaver;

internal static class AppServices
{
    internal static readonly ScriptRepository Scripts = new();
    internal static readonly ScriptEngine ScriptEngine = new();
    internal static readonly WindowsDeviceManager Device = new();
    internal static readonly FirmwareUpdateManager FirmwareUpdater = new();
    internal static readonly AppSettings Settings = new();
    internal static readonly McpServer McpServer = new(Settings, Scripts, Device);

    internal static readonly HttpClient Http = new();
    internal static readonly AppUpdateService AppUpdates = new(Http);
    internal static readonly HostSessionManager HostSession = new();
}
