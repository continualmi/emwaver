using Microsoft.UI.Xaml;
using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Storage;

namespace EMWaver.Services.Cloud;

internal sealed class HostSessionManager
{
    private readonly HttpClient _http;
    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;
    private readonly Func<(bool usbConnected, string portName, bool scriptRunning, string scriptName)> _statusProvider;

    private readonly DispatcherTimer _timer = new();

    private const string HostSessionIdKey = "emwaver.hostSessionId";
    internal string HostSessionId { get; }

    internal HostSessionManager(
        HttpClient http,
        CloudConfig cfg,
        CloudAuthManager auth,
        Func<(bool usbConnected, string portName, bool scriptRunning, string scriptName)> statusProvider)
    {
        _http = http;
        _cfg = cfg;
        _auth = auth;
        _statusProvider = statusProvider;

        HostSessionId = GetOrCreateHostSessionId();

        _timer.Interval = TimeSpan.FromSeconds(10);
        _timer.Tick += async (_, __) => await SendHeartbeatAsync();
    }

    internal void Start()
    {
        try
        {
            _timer.Start();
            _ = SendHeartbeatAsync();
        }
        catch { }
    }

    internal void Stop()
    {
        try { _timer.Stop(); } catch { }
    }

    private static string GetOrCreateHostSessionId()
    {
        var fileId = ReadHostSessionIdFromFile();
        if (!string.IsNullOrWhiteSpace(fileId))
        {
            return fileId!;
        }

        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            if (ls.Values.TryGetValue(HostSessionIdKey, out var v) && v is string s && !string.IsNullOrWhiteSpace(s))
            {
                TryWriteHostSessionIdToFile(s);
                return s;
            }
            var id = Guid.NewGuid().ToString();
            ls.Values[HostSessionIdKey] = id;
            TryWriteHostSessionIdToFile(id);
            return id;
        }
        catch
        {
            var id = Guid.NewGuid().ToString();
            TryWriteHostSessionIdToFile(id);
            return id;
        }
    }

    private static string HostSessionIdFilePath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver"
        );
        return Path.Combine(dir, "host_session_id.txt");
    }

    private static string? ReadHostSessionIdFromFile()
    {
        try
        {
            var path = HostSessionIdFilePath();
            if (!File.Exists(path)) return null;

            var id = (File.ReadAllText(path) ?? "").Trim();
            return string.IsNullOrWhiteSpace(id) ? null : id;
        }
        catch
        {
            return null;
        }
    }

    private static void TryWriteHostSessionIdToFile(string id)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            var path = HostSessionIdFilePath();
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            File.WriteAllText(path, id.Trim());
        }
        catch
        {
        }
    }

    private async Task SendHeartbeatAsync()
    {
        try
        {
            var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
            var tok = await _auth.GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false);
            if (string.IsNullOrWhiteSpace(tok) && !allowAnon)
            {
                return;
            }

            var (usbConnected, portName, scriptRunning, scriptName) = _statusProvider();

            var payload = new
            {
                host_session_id = HostSessionId,
                platform = "windows",
                device_name = Environment.MachineName,
                app_version = "", // TODO: wire package version
                capabilities = new { usb = true, scripts = true },
                status = new
                {
                    usb_connected = usbConnected,
                    connected_port = portName ?? "",
                    script_running = scriptRunning,
                    active_script_name = scriptName ?? ""
                }
            };

            var json = JsonSerializer.Serialize(payload);
            using var req = new HttpRequestMessage(HttpMethod.Post, _cfg.BackendBaseUrl + "/v1/hosts/heartbeat");
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (!string.IsNullOrWhiteSpace(tok))
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);
            }
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");

            using var res = await _http.SendAsync(req);
            // Best-effort: ignore failures.
            _ = await res.Content.ReadAsStringAsync();
        }
        catch
        {
        }
    }
}
