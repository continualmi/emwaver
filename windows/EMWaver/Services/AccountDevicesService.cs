using EMWaver.Services.Cloud;
using Microsoft.UI.Dispatching;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class AccountDevicesService : INotifyPropertyChanged
{
    internal sealed record DeviceRecord
    {
        [JsonPropertyName("device_id_b64")]
        public string DeviceIdB64 { get; init; } = "";

        [JsonPropertyName("label")]
        public string Label { get; init; } = "";

        [JsonPropertyName("board_type")]
        public string? BoardType { get; init; }

        [JsonPropertyName("hardware_uid")]
        public string? HardwareUid { get; init; }

        [JsonPropertyName("created_at_ms")]
        public long CreatedAtMs { get; init; }

        [JsonPropertyName("updated_at_ms")]
        public long UpdatedAtMs { get; init; }

        [JsonPropertyName("last_seen_at_ms")]
        public long LastSeenAtMs { get; init; }
    }

    private sealed record DevicesResponse(
        [property: JsonPropertyName("devices")] List<DeviceRecord>? Devices
    );

    private readonly HttpClient _http;
    private readonly Func<CloudAuthManager> _auth;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private DispatcherQueue? _ui;
    private bool _started;
    private CloudAuthManager? _subscribedAuth;

    internal AccountDevicesService(HttpClient http, Func<CloudAuthManager> auth)
    {
        _http = http;
        _auth = auth;
    }

    internal ObservableCollection<DeviceRecord> Devices { get; } = new();

    private bool _isOfflineMode;
    internal bool IsOfflineMode
    {
        get => _isOfflineMode;
        private set
        {
            if (_isOfflineMode == value) return;
            _isOfflineMode = value;
            OnPropertyChanged();
        }
    }

    private DateTimeOffset? _lastSyncAt;
    internal DateTimeOffset? LastSyncAt
    {
        get => _lastSyncAt;
        private set
        {
            if (_lastSyncAt == value) return;
            _lastSyncAt = value;
            OnPropertyChanged();
        }
    }

    private string? _lastError;
    internal string? LastError
    {
        get => _lastError;
        private set
        {
            if (_lastError == value) return;
            _lastError = value;
            OnPropertyChanged();
        }
    }

    private bool _isRefreshing;
    internal bool IsRefreshing
    {
        get => _isRefreshing;
        private set
        {
            if (_isRefreshing == value) return;
            _isRefreshing = value;
            OnPropertyChanged();
        }
    }

    private bool _hasLoadedOnce;
    internal bool HasLoadedOnce
    {
        get => _hasLoadedOnce;
        private set
        {
            if (_hasLoadedOnce == value) return;
            _hasLoadedOnce = value;
            OnPropertyChanged();
        }
    }

    internal void AttachUiDispatcher(DispatcherQueue dispatcherQueue)
    {
        _ui = dispatcherQueue;
    }

    internal void Start()
    {
        if (_started) return;
        _started = true;

        LoadCache();
        EnsureAuthSubscription();
        Refresh();
    }

    internal void Refresh()
    {
        EnsureAuthSubscription();
        _ = RefreshAsync();
    }

    internal async Task RefreshAsync()
    {
        await _refreshLock.WaitAsync();
        try
        {
            await PerformRefreshAsync();
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    internal bool HasOfflineAccess(string boardType, string hardwareUid)
    {
        var boardTypeNorm = Normalize(boardType);
        var hardwareUidNorm = Normalize(hardwareUid);
        if (boardTypeNorm.Length == 0 || hardwareUidNorm.Length == 0)
        {
            return false;
        }

        return Devices.Any(device =>
            Normalize(device.BoardType) == boardTypeNorm &&
            Normalize(device.HardwareUid) == hardwareUidNorm);
    }

    internal void StoreClaimedDevice(string deviceIdB64, string boardType, string hardwareUid)
    {
        RunOnUi(() =>
        {
            var nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var boardTypeNorm = Normalize(boardType);
            var hardwareUidNorm = Normalize(hardwareUid);

            int index = Devices
                .Select((device, idx) => new { device, idx })
                .Where(x =>
                    string.Equals(x.device.DeviceIdB64, deviceIdB64, StringComparison.Ordinal) ||
                    (Normalize(x.device.BoardType) == boardTypeNorm &&
                     Normalize(x.device.HardwareUid) == hardwareUidNorm))
                .Select(x => x.idx)
                .DefaultIfEmpty(-1)
                .First();

            var updated = new DeviceRecord
            {
                DeviceIdB64 = deviceIdB64,
                Label = "EMWaver device",
                BoardType = boardType,
                HardwareUid = hardwareUid,
                CreatedAtMs = index >= 0 ? Devices[index].CreatedAtMs : nowMs,
                UpdatedAtMs = nowMs,
                LastSeenAtMs = nowMs,
            };

            if (index >= 0)
            {
                Devices[index] = updated;
            }
            else
            {
                Devices.Insert(0, updated);
            }

            PersistCache();
            LastSyncAt = DateTimeOffset.UtcNow;
            HasLoadedOnce = true;
        });
    }

    internal bool ClaimStatusResolved(string boardType, string hardwareUid, bool signedIn)
    {
        if (HasOfflineAccess(boardType, hardwareUid))
        {
            return true;
        }
        if (IsOfflineMode || !signedIn)
        {
            return true;
        }
        if (IsRefreshing)
        {
            return false;
        }
        return HasLoadedOnce;
    }

    private async Task PerformRefreshAsync()
    {
        RunOnUi(() => IsRefreshing = true);
        try
        {
            var offline = !System.Net.NetworkInformation.NetworkInterface.GetIsNetworkAvailable();
            RunOnUi(() => IsOfflineMode = offline);

            if (offline)
            {
                LoadCache();
                RunOnUi(() => LastError = null);
                return;
            }

            var token = await _auth().GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false);
            if (string.IsNullOrWhiteSpace(token))
            {
                LoadCache();
                RunOnUi(() => LastError = null);
                return;
            }

            var url = $"{BackendUrl.Resolve().TrimEnd('/')}/v1/devices/my";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Accept.ParseAdd("application/json");
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            using var res = await _http.SendAsync(req);
            var body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(string.IsNullOrWhiteSpace(body)
                    ? $"Device list fetch failed (HTTP {(int)res.StatusCode})"
                    : body);
            }

            var decoded = JsonSerializer.Deserialize<DevicesResponse>(body);
            var merged = MergeBackendDevices(decoded?.Devices ?? new List<DeviceRecord>(), SnapshotDevices());

            RunOnUi(() =>
            {
                ReplaceDevices(merged);
                PersistCache();
                LastSyncAt = DateTimeOffset.UtcNow;
                LastError = null;
            });
        }
        catch (Exception ex)
        {
            RunOnUi(() => LastError = ex.Message);
            LoadCache();
        }
        finally
        {
            RunOnUi(() =>
            {
                IsRefreshing = false;
                HasLoadedOnce = true;
            });
        }
    }

    private List<DeviceRecord> SnapshotDevices()
    {
        return Devices.ToList();
    }

    private void ReplaceDevices(IEnumerable<DeviceRecord> devices)
    {
        Devices.Clear();
        foreach (var device in devices
            .OrderByDescending(x => x.LastSeenAtMs)
            .ThenBy(x => x.Label, StringComparer.OrdinalIgnoreCase))
        {
            Devices.Add(device);
        }
    }

    private List<DeviceRecord> MergeBackendDevices(List<DeviceRecord> backend, List<DeviceRecord> local)
    {
        var merged = new List<DeviceRecord>(backend);

        foreach (var localRecord in local)
        {
            var localKey = RecordKey(localRecord);
            var index = merged.FindIndex(record =>
                string.Equals(record.DeviceIdB64, localRecord.DeviceIdB64, StringComparison.Ordinal) ||
                (!string.IsNullOrWhiteSpace(localKey) && string.Equals(RecordKey(record), localKey, StringComparison.Ordinal)));

            if (index < 0)
            {
                merged.Add(localRecord);
                continue;
            }

            var backendRecord = merged[index];
            merged[index] = backendRecord with
            {
                Label = string.IsNullOrWhiteSpace(backendRecord.Label) ? localRecord.Label : backendRecord.Label,
                BoardType = backendRecord.BoardType ?? localRecord.BoardType,
                HardwareUid = backendRecord.HardwareUid ?? localRecord.HardwareUid,
                LastSeenAtMs = Math.Max(backendRecord.LastSeenAtMs, localRecord.LastSeenAtMs),
                UpdatedAtMs = Math.Max(backendRecord.UpdatedAtMs, localRecord.UpdatedAtMs),
                CreatedAtMs = backendRecord.CreatedAtMs == 0 ? localRecord.CreatedAtMs : backendRecord.CreatedAtMs,
            };
        }

        return merged;
    }

    private string? RecordKey(DeviceRecord record)
    {
        var boardType = Normalize(record.BoardType);
        var hardwareUid = Normalize(record.HardwareUid);
        if (boardType.Length == 0 || hardwareUid.Length == 0)
        {
            return null;
        }
        return $"{boardType}:{hardwareUid}";
    }

    private void PersistCache()
    {
        try
        {
            var path = CachePath();
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var data = JsonSerializer.SerializeToUtf8Bytes(Devices.ToList());
            File.WriteAllBytes(path, data);
        }
        catch
        {
            // Best-effort cache only.
        }
    }

    private void LoadCache()
    {
        try
        {
            var path = CachePath();
            if (!File.Exists(path))
            {
                RunOnUi(() =>
                {
                    Devices.Clear();
                    HasLoadedOnce = true;
                });
                return;
            }

            var data = File.ReadAllBytes(path);
            var decoded = JsonSerializer.Deserialize<List<DeviceRecord>>(data) ?? new List<DeviceRecord>();
            RunOnUi(() =>
            {
                ReplaceDevices(decoded);
                HasLoadedOnce = true;
            });
        }
        catch
        {
            RunOnUi(() =>
            {
                Devices.Clear();
                HasLoadedOnce = true;
            });
        }
    }

    private static string CachePath()
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ContinualMI",
            "EMWaver");
        return Path.Combine(root, "account-devices.json");
    }

    private void OnAuthChanged()
    {
        Refresh();
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

    private void RunOnUi(Action fn)
    {
        var ui = _ui;
        if (ui == null || ui.HasThreadAccess)
        {
            fn();
            return;
        }

        _ = ui.TryEnqueue(new DispatcherQueueHandler(fn));
    }

    private static string Normalize(string? value)
    {
        return (value ?? string.Empty).Trim().ToUpperInvariant();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
