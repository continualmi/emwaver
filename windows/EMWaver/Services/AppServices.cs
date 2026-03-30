using EMWaver.Services;
using EMWaver.Services.Cloud;
using EMWaver.Services.Pro;
using System.Net.Http;

namespace EMWaver;

internal static class AppServices
{
    internal static readonly ScriptRepository Scripts = new();
    internal static readonly WindowsDeviceManager Device = new();
    internal static readonly FirmwareUpdateManager FirmwareUpdater = new();
    internal static readonly AppSettings Settings = new();

    // Cloud sync and account auth (web-managed EMWaver API keys + Azure Blob storage via backend SAS URLs)
    internal static readonly HttpClient Http = new();
    internal static CloudConfig CloudConfig = CloudConfig.FromEnvironment();
    internal static CloudAuthManager CloudAuth = new(CloudConfig);
    internal static CloudFilesClient CloudFiles = new(Http, CloudConfig, CloudAuth);
    internal static CloudHostsClient CloudHosts = new(Http, CloudConfig, CloudAuth);

    internal static HostSessionManager HostSession = new(
        Http,
        CloudConfig,
        CloudAuth,
        statusProvider: () => (
            usbConnected: Device.IsConnected,
            portName: Device.ConnectedPort?.DisplayName ?? "",
            scriptRunning: false,
            scriptName: ""
        )
    );

    // Remote control host WS (web can attach + drive scripts/UI).
    internal static RemoteControlHostService RemoteControlHost = new(CloudConfig, CloudAuth);
    internal static RemoteControlClientService RemoteControlClient = new(CloudConfig, CloudAuth);
    internal static EntitlementsManager Entitlements = new(Http, () => CloudConfig, () => CloudAuth);
    internal static AccountDevicesService AccountDevices = new(Http, () => CloudAuth);

    internal static void ReloadCloud()
    {
        CloudConfig = CloudConfig.FromEnvironment();
        CloudAuth = new CloudAuthManager(CloudConfig);
        CloudFiles = new CloudFilesClient(Http, CloudConfig, CloudAuth);
        CloudHosts = new CloudHostsClient(Http, CloudConfig, CloudAuth);
        HostSession = new HostSessionManager(
            Http,
            CloudConfig,
            CloudAuth,
            statusProvider: () => (
                usbConnected: Device.IsConnected,
                portName: Device.ConnectedPort?.DisplayName ?? "",
                scriptRunning: false,
                scriptName: ""
            )
        );
        RemoteControlHost = new RemoteControlHostService(CloudConfig, CloudAuth);
        RemoteControlClient = new RemoteControlClientService(CloudConfig, CloudAuth);
        Entitlements = new EntitlementsManager(Http, () => CloudConfig, () => CloudAuth);
    }
}
