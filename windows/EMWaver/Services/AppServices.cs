using EMWaver.Services;
using EMWaver.Services.Agent;
using System.Net.Http;

namespace EMWaver;

internal static class AppServices
{
    internal static readonly ScriptRepository Scripts = new();
    internal static readonly WindowsDeviceManager Device = new();
    internal static readonly FirmwareUpdateManager FirmwareUpdater = new();
    internal static readonly AppSettings Settings = new();

    internal static readonly HttpClient Http = new();
    internal static readonly AgentApiKeyStore AgentKeys = new();
    internal static readonly AgentChatStore AgentChats = new();
    internal static readonly HostSessionManager HostSession = new();
    internal static readonly RemoteControlHostService RemoteControlHost = new();
}
