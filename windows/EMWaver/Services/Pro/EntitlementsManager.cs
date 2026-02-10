using EMWaver.Services.Cloud;
using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Pro;

internal sealed class EntitlementsManager
{
    internal sealed class Entitlements
    {
        internal sealed class Features
        {
            [JsonPropertyName("cloudHosts")]
            public bool CloudHosts { get; set; }

            [JsonPropertyName("cloudFiles")]
            public bool CloudFiles { get; set; }

            [JsonPropertyName("agent")]
            public bool Agent { get; set; }
        }

        [JsonPropertyName("pro")]
        public bool Pro { get; set; }

        [JsonPropertyName("features")]
        public Features FeatureFlags { get; set; } = new();
    }

    internal sealed class PurchaseEligibility
    {
        [JsonPropertyName("canPurchasePro")]
        public bool CanPurchasePro { get; set; }

        [JsonPropertyName("reason")]
        public string? Reason { get; set; }

        [JsonPropertyName("requiresDeviceAttached")]
        public bool RequiresDeviceAttached { get; set; }

        [JsonPropertyName("hasDeviceAttached")]
        public bool HasDeviceAttached { get; set; }
    }

    internal sealed class Snapshot
    {
        public Entitlements? Entitlements { get; init; }
        public PurchaseEligibility? Eligibility { get; init; }
        public string? LastError { get; init; }

        public bool IsPro => Entitlements?.Pro ?? false;
    }

    private readonly HttpClient _http;
    private readonly Func<CloudConfig> _config;
    private readonly Func<CloudAuthManager> _auth;

    private Snapshot _last = new();
    private DateTimeOffset? _lastFetchAt;

    internal EntitlementsManager(HttpClient http, Func<CloudConfig> config, Func<CloudAuthManager> auth)
    {
        _http = http;
        _config = config;
        _auth = auth;
    }

    internal Snapshot Last => _last;

    internal async Task<Snapshot> RefreshAsync(bool force, CancellationToken ct)
    {
        if (!force && _lastFetchAt.HasValue && (DateTimeOffset.UtcNow - _lastFetchAt.Value).TotalSeconds < 10)
        {
            return _last;
        }

        _lastFetchAt = DateTimeOffset.UtcNow;

        var cfg = _config();
        var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
        var token = _auth().GetIdToken() ?? "";
        if (string.IsNullOrWhiteSpace(token) && !allowAnon)
        {
            _last = new Snapshot();
            return _last;
        }

        try
        {
            var ent = await GetAsync<Entitlements>(cfg.BackendBaseUrl, "v1/entitlements", token, ct);
            var eligibility = await GetAsync<PurchaseEligibility>(cfg.BackendBaseUrl, "v1/billing/eligibility", token, ct);
            _last = new Snapshot { Entitlements = ent, Eligibility = eligibility, LastError = null };
        }
        catch (Exception ex)
        {
            _last = new Snapshot
            {
                Entitlements = _last.Entitlements,
                Eligibility = _last.Eligibility,
                LastError = ex.Message
            };
        }

        return _last;
    }

    private async Task<T> GetAsync<T>(string baseUrl, string path, string accessToken, CancellationToken ct)
    {
        var url = new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Clear();
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (!string.IsNullOrWhiteSpace(accessToken))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(body) ? $"HTTP {(int)res.StatusCode}" : body);
        }

        var decoded = JsonSerializer.Deserialize<T>(body);
        if (decoded == null)
        {
            throw new InvalidOperationException("Invalid server response");
        }

        return decoded;
    }
}
