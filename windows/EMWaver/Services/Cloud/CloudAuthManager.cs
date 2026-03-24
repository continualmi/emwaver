using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;

namespace EMWaver.Services.Cloud;

internal sealed class CloudAuthManager
{
    private const string KeyIdToken = "cloud.emwaver.accessToken";
    private const string KeyRefreshToken = "cloud.emwaver.sessionToken";

    private readonly CloudConfig _cfg;
    private readonly FirebaseAuthService _firebase;
    private readonly HttpClient _http = new();
    private readonly SemaphoreSlim _tokenRefreshLock = new(1, 1);

    private string? _idToken;
    private string? _refreshToken;

    internal event Action? Changed;

    private sealed record Persisted(string? IdToken, string? RefreshToken);

    internal CloudAuthManager(CloudConfig cfg, GoogleOAuthPkce google, FirebaseAuthService firebase)
    {
        _cfg = cfg;
        _firebase = firebase;

        // Best-effort hydrate tokens so IsSignedIn works in unpackaged runs.
        TryLoadPersisted();

        // Also try LocalSettings (packaged) if we don't already have them.
        if (string.IsNullOrWhiteSpace(_idToken))
        {
            _idToken = TryReadLocalSetting(KeyIdToken);
            _refreshToken = TryReadLocalSetting(KeyRefreshToken);
        }
    }

    internal bool IsSignedIn => !string.IsNullOrWhiteSpace(GetIdToken());

    internal string? GetIdToken()
    {
        if (!string.IsNullOrWhiteSpace(_idToken))
        {
            return _idToken;
        }

        // Packaged: try LocalSettings.
        var ls = TryReadLocalSetting(KeyIdToken);
        if (!string.IsNullOrWhiteSpace(ls))
        {
            _idToken = ls;
            return _idToken;
        }

        // Unpackaged: try file.
        TryLoadPersisted();
        return _idToken;
    }

    internal async Task<string> EnsureSignedInAsync(CancellationToken ct)
    {
        var existing = await GetValidIdTokenAsync(ct, interactiveSignIn: false);
        if (!string.IsNullOrWhiteSpace(existing))
        {
            return existing!;
        }

        return await SignInInteractiveAsync(ct);
    }

    internal async Task<string?> GetValidIdTokenAsync(CancellationToken ct, bool interactiveSignIn)
    {
        var token = GetIdToken();
        if (!string.IsNullOrWhiteSpace(token) && !IsLikelyExpired(token!))
        {
            return token;
        }

        await _tokenRefreshLock.WaitAsync(ct);
        try
        {
            token = GetIdToken();
            if (!string.IsNullOrWhiteSpace(token) && !IsLikelyExpired(token!))
            {
                return token;
            }

            if (interactiveSignIn)
            {
                return await SignInInteractiveAsync(ct);
            }

            // If we couldn't refresh, do not return an expired token.
            return null;
        }
        finally
        {
            _tokenRefreshLock.Release();
        }
    }

    internal Task<string> SignInInteractiveAsync(CancellationToken ct)
    {
        _ = ct;
        var signin = BuildSigninUrl();
        OpenBrowser(signin.ToString());

        return Task.FromException<string>(new InvalidOperationException(
            "Complete sign-in in your browser, then paste the one-time EMW handoff code in Settings."
        ));
    }

    internal async Task<string> SignInWithHandoffCodeAsync(string code, CancellationToken ct)
    {
        var trimmed = (code ?? "").Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException("Missing handoff code");
        }

        var consume = new Uri(new Uri(_cfg.BackendBaseUrl.TrimEnd('/') + "/"), "v1/auth/handoff/consume");
        using var req = new HttpRequestMessage(HttpMethod.Post, consume)
        {
            Content = JsonContent.Create(new { code = trimmed })
        };
        using var res = await _http.SendAsync(req, ct);
        var resJson = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(resJson) ? $"HTTP {(int)res.StatusCode}" : resJson);
        }

        using var doc = JsonDocument.Parse(resJson);
        var root = doc.RootElement;
        var accessToken = root.TryGetProperty("access_token", out var tokenEl) ? tokenEl.GetString() : null;
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            throw new InvalidOperationException("Missing access_token");
        }

        _idToken = accessToken;
        _refreshToken = accessToken;

        // Best-effort persistence in BOTH contexts:
        // - Packaged apps: ApplicationData.Current.LocalSettings
        // - Unpackaged/dev: LocalAppData json file
        TryWriteLocalSetting(KeyIdToken, _idToken);
        TryWriteLocalSetting(KeyRefreshToken, _refreshToken);
        TrySavePersisted();
        Changed?.Invoke();

        return _idToken ?? "";
    }

    internal Uri BuildSigninUrl()
    {
        var baseUrl = "https://continualmi.com";
        return new Uri($"{baseUrl}/emwaver/handoff");
    }

    private static void OpenBrowser(string url)
    {
        var psi = new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        };
        Process.Start(psi);
    }

    internal void SignOut()
    {
        _idToken = null;
        _refreshToken = null;

        TryRemoveLocalSetting(KeyIdToken);
        TryRemoveLocalSetting(KeyRefreshToken);

        try
        {
            var path = PersistPath();
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
        }

        Changed?.Invoke();
    }

    private string? GetRefreshToken()
    {
        if (!string.IsNullOrWhiteSpace(_refreshToken))
        {
            return _refreshToken;
        }

        var ls = TryReadLocalSetting(KeyRefreshToken);
        if (!string.IsNullOrWhiteSpace(ls))
        {
            _refreshToken = ls;
            return _refreshToken;
        }

        TryLoadPersisted();
        return _refreshToken;
    }

    private static bool IsLikelyExpired(string jwt)
    {
        try
        {
            var parts = jwt.Split('.');
            if (parts.Length < 2) return false;

            var payload = parts[1]
                .Replace('-', '+')
                .Replace('_', '/');
            payload = payload.PadRight(payload.Length + ((4 - payload.Length % 4) % 4), '=');

            var bytes = Convert.FromBase64String(payload);
            using var doc = JsonDocument.Parse(bytes);
            if (!doc.RootElement.TryGetProperty("exp", out var expEl)) return false;

            long expSeconds;
            if (expEl.ValueKind == JsonValueKind.Number)
            {
                if (!expEl.TryGetInt64(out expSeconds)) return false;
            }
            else if (expEl.ValueKind == JsonValueKind.String && long.TryParse(expEl.GetString(), out var parsed))
            {
                expSeconds = parsed;
            }
            else
            {
                return false;
            }

            var expAt = DateTimeOffset.FromUnixTimeSeconds(expSeconds);
            return expAt <= DateTimeOffset.UtcNow.AddMinutes(2);
        }
        catch
        {
            return false;
        }
    }

    // MARK: - Persistence helpers

    private static string? TryReadLocalSetting(string key)
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            return ls.Values.TryGetValue(key, out var v) ? v as string : null;
        }
        catch
        {
            return null;
        }
    }

    private static void TryWriteLocalSetting(string key, string? value)
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            if (string.IsNullOrWhiteSpace(value))
            {
                ls.Values.Remove(key);
            }
            else
            {
                ls.Values[key] = value;
            }
        }
        catch
        {
        }
    }

    private static void TryRemoveLocalSetting(string key)
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            ls.Values.Remove(key);
        }
        catch
        {
        }
    }

    private static string PersistPath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver"
        );
        return Path.Combine(dir, "cloud_auth.json");
    }

    private void TryLoadPersisted()
    {
        try
        {
            var path = PersistPath();
            if (!File.Exists(path))
            {
                return;
            }

            var json = File.ReadAllText(path);
            var data = JsonSerializer.Deserialize<Persisted>(json);
            if (data != null)
            {
                if (!string.IsNullOrWhiteSpace(data.IdToken)) _idToken = data.IdToken;
                if (!string.IsNullOrWhiteSpace(data.RefreshToken)) _refreshToken = data.RefreshToken;
            }
        }
        catch
        {
        }
    }

    private void TrySavePersisted()
    {
        try
        {
            var path = PersistPath();
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            var json = JsonSerializer.Serialize(new Persisted(_idToken, _refreshToken));
            File.WriteAllText(path, json);
        }
        catch
        {
        }
    }
}
