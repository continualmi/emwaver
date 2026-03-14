using EMWaver.Services.Cloud;
using System;
using System.ComponentModel;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class DeviceRegistryService
{
    private readonly HttpClient _http;
    private readonly Func<CloudAuthManager> _auth;
    private readonly Func<AccountDevicesService> _accountDevices;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    private WindowsDeviceManager? _device;
    private string _lastSeenKey = "";
    private bool _started;
    private CloudAuthManager? _subscribedAuth;

    internal DeviceRegistryService(HttpClient http, Func<CloudAuthManager> auth, Func<AccountDevicesService> accountDevices)
    {
        _http = http;
        _auth = auth;
        _accountDevices = accountDevices;
    }

    internal void Start(WindowsDeviceManager device)
    {
        if (_started) return;
        _started = true;
        _device = device;

        device.PropertyChanged += OnDevicePropertyChanged;
        EnsureAuthSubscription();
        QueueSync();
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(WindowsDeviceManager.IsConnected) ||
            e.PropertyName == nameof(WindowsDeviceManager.IsSecureConnected) ||
            e.PropertyName == nameof(WindowsDeviceManager.SecureDeviceIdB64) ||
            e.PropertyName == nameof(WindowsDeviceManager.SecureDeviceProofB64) ||
            e.PropertyName == nameof(WindowsDeviceManager.HardwareUidHex) ||
            e.PropertyName == nameof(WindowsDeviceManager.ConnectedBoardType))
        {
            QueueSync();
        }
    }

    private void OnAuthChanged()
    {
        QueueSync();
    }

    private void QueueSync()
    {
        EnsureAuthSubscription();
        _ = SyncAsync();
    }

    private void EnsureAuthSubscription()
    {
        var auth = _auth();
        if (ReferenceEquals(_subscribedAuth, auth))
        {
            return;
        }

        if (_subscribedAuth != null)
        {
            _subscribedAuth.Changed -= OnAuthChanged;
        }

        _subscribedAuth = auth;
        _subscribedAuth.Changed += OnAuthChanged;
    }

    private async Task SyncAsync()
    {
        var device = _device;
        if (device == null) return;
        if (!device.IsConnected || !device.IsSecureConnected) return;
        if (string.IsNullOrWhiteSpace(device.SecureDeviceIdB64) || string.IsNullOrWhiteSpace(device.SecureDeviceProofB64)) return;

        await _syncLock.WaitAsync();
        try
        {
            var token = await _auth().GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false) ?? "";
            var key = $"{device.SecureDeviceIdB64}:{(string.IsNullOrWhiteSpace(token) ? "anon" : "auth")}";
            if (string.Equals(_lastSeenKey, key, StringComparison.Ordinal))
            {
                return;
            }

            _lastSeenKey = key;
            device.DeviceAttachStatusText = "Checking device...";

            var url = $"{BackendUrl.Resolve().TrimEnd('/')}/v1/devices/seen";
            using var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Accept.ParseAdd("application/json");
            if (!string.IsNullOrWhiteSpace(token))
            {
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            }

            var payload = JsonSerializer.Serialize(new
            {
                device_id_b64 = device.SecureDeviceIdB64,
                proof_b64 = device.SecureDeviceProofB64,
            });
            req.Content = new StringContent(payload, Encoding.UTF8, "application/json");

            using var res = await _http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                device.DeviceAttachStatusText = string.IsNullOrWhiteSpace(body)
                    ? $"Device check failed (HTTP {(int)res.StatusCode})"
                    : body;
                return;
            }

            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
            var root = doc.RootElement;

            var needsLogin = root.TryGetProperty("needs_login", out var needsLoginEl) && needsLoginEl.GetBoolean();
            var attached = root.TryGetProperty("attached", out var attachedEl) && attachedEl.GetBoolean();
            var claimed = root.TryGetProperty("claimed", out var claimedEl) && claimedEl.GetBoolean();

            if (needsLogin && string.IsNullOrWhiteSpace(token))
            {
                device.NeedsLoginToSaveDevice = true;
                device.DeviceAttachStatusText = "Sign in to save device";
                return;
            }

            device.NeedsLoginToSaveDevice = false;
            device.DeviceAttachStatusText = attached
                ? "Device saved to account"
                : (claimed ? "Device verified" : "Device verified");

            if (!string.IsNullOrWhiteSpace(device.HardwareUidHex) &&
                !string.IsNullOrWhiteSpace(device.ConnectedBoardType) &&
                !string.IsNullOrWhiteSpace(device.SecureDeviceIdB64))
            {
                _accountDevices().StoreClaimedDevice(
                    device.SecureDeviceIdB64!,
                    device.ConnectedBoardType!,
                    device.HardwareUidHex!);
            }
        }
        catch (Exception ex)
        {
            device.DeviceAttachStatusText = ex.Message;
        }
        finally
        {
            _syncLock.Release();
        }
    }
}
