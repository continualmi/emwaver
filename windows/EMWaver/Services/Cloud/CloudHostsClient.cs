using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class CloudHostsClient
{
    internal sealed class CloudHostsClientError : Exception
    {
        internal int StatusCode { get; }
        internal CloudHostsClientError(int statusCode, string message) : base(message)
        {
            StatusCode = statusCode;
        }
    }

    private readonly HttpClient _http;
    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;

    internal CloudHostsClient(HttpClient http, CloudConfig cfg, CloudAuthManager auth)
    {
        _http = http;
        _cfg = cfg;
        _auth = auth;
    }

    private async Task<HttpRequestMessage> MakeRequestAsync(string path, string? accessToken, CancellationToken ct)
    {
        var token = accessToken;
        if (token == null)
        {
            token = await _auth.EnsureSignedInAsync(ct);
        }

        var req = new HttpRequestMessage(HttpMethod.Get, _cfg.BackendBaseUrl + path);
        if (!string.IsNullOrWhiteSpace(token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return req;
    }

    internal async Task<IReadOnlyList<HostSession>> ListAsync(string? accessToken, CancellationToken ct)
    {
        using var req = await MakeRequestAsync("/v1/hosts", accessToken, ct);
        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudHostsClientError((int)res.StatusCode, "List hosts failed: " + json);
        }

        var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var decoded = JsonSerializer.Deserialize<HostSessionsResponse>(json, opts);
        return decoded?.ToModel() ?? new List<HostSession>();
    }
}
