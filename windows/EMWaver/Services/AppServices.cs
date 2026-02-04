using EMWaver.Services;
using EMWaver.Services.Cloud;
using System.Net.Http;

namespace EMWaver;

internal static class AppServices
{
    internal static readonly ScriptRepository Scripts = new();
    internal static readonly WindowsDeviceManager Device = new();
    internal static readonly FirmwareUpdateManager FirmwareUpdater = new();
    internal static readonly AppSettings Settings = new();

    // Cloud sync (Google via Firebase Auth + Azure Blob storage via backend SAS URLs)
    internal static readonly HttpClient Http = new();
    internal static readonly CloudConfig CloudConfig = CloudConfig.FromEnvironment();
    internal static readonly CloudAuthManager CloudAuth = new(
        CloudConfig,
        google: new GoogleOAuthPkce(Http),
        firebase: new FirebaseAuthService(Http)
    );
    internal static readonly CloudFilesClient CloudFiles = new(Http, CloudConfig, CloudAuth);
}
