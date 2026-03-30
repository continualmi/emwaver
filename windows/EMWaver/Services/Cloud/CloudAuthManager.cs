using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;
using Windows.System;

namespace EMWaver.Services.Cloud;

internal sealed class CloudAuthManager
{
    private const string KeyApiKey = "cloud.emwaver.apiKey";
    private const string KeyEmail = "cloud.emwaver.email";
    private const string KeyName = "cloud.emwaver.name";
    private const string KeyUid = "cloud.emwaver.uid";

    private const string LegacyKeyIdToken = "cloud.emwaver.accessToken";
    private const string LegacyKeyRefreshToken = "cloud.emwaver.sessionToken";

    private const string PersistFileName = "cloud_api_key.json";
    private const string LegacyPersistFileName = "cloud_auth.json";

    private readonly CloudConfig _cfg;
    private readonly HttpClient _http = new();

    private string? _apiKey;
    private string? _email;
    private string? _displayName;
    private string? _uid;

    internal event Action? Changed;

    private sealed record Persisted(string? ApiKey, string? Uid, string? Email, string? DisplayName);
    private sealed record ValidationResult(string? Uid, string? Email, string? DisplayName);

    internal CloudAuthManager(CloudConfig cfg)
    {
        _cfg = cfg;

        TryLoadPersisted();
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            _apiKey = TryReadLocalSetting(KeyApiKey);
        }

        if (string.IsNullOrWhiteSpace(_uid))
        {
            _uid = TryReadLocalSetting(KeyUid);
        }

        if (string.IsNullOrWhiteSpace(_email))
        {
            _email = TryReadLocalSetting(KeyEmail);
        }

        if (string.IsNullOrWhiteSpace(_displayName))
        {
            _displayName = TryReadLocalSetting(KeyName);
        }
    }

    internal bool IsSignedIn => !string.IsNullOrWhiteSpace(GetIdToken());

    internal string? GetIdToken()
    {
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            return _apiKey;
        }

        var ls = TryReadLocalSetting(KeyApiKey);
        if (!string.IsNullOrWhiteSpace(ls))
        {
            _apiKey = ls;
            return _apiKey;
        }

        TryLoadPersisted();
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            return _apiKey;
        }

        return null;
    }

    internal async Task<string> EnsureSignedInAsync(CancellationToken ct)
    {
        var existing = await GetValidIdTokenAsync(ct, interactiveSignIn: false);
        if (!string.IsNullOrWhiteSpace(existing))
        {
            return existing!;
        }

        await SignInInteractiveAsync(ct);
        throw new InvalidOperationException(
            "Create or replace your EMWaver API key on the web, then paste it into the Account dialog."
        );
    }

    internal async Task<string?> GetValidIdTokenAsync(CancellationToken ct, bool interactiveSignIn)
    {
        var token = GetIdToken();
        if (!string.IsNullOrWhiteSpace(token))
        {
            return token;
        }

        if (interactiveSignIn)
        {
            await SignInInteractiveAsync(ct);
        }

        return null;
    }

    internal async Task<string> SaveApiKeyAsync(string apiKey, CancellationToken ct)
    {
        var trimmed = (apiKey ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException("Enter an EMWaver API key.");
        }

        var validation = await ValidateApiKeyAsync(trimmed, ct);
        _apiKey = trimmed;
        _uid = validation.Uid;
        _email = validation.Email;
        _displayName = validation.DisplayName;

        PersistCredential();
        Changed?.Invoke();
        return _apiKey;
    }

    internal async Task SignInInteractiveAsync(CancellationToken ct)
    {
        await OpenAccountManagementAsync(ct);
    }

    internal async Task OpenAccountManagementAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var url = BuildAccountManagementUrl();
        var opened = await Launcher.LaunchUriAsync(url);
        if (!opened)
        {
            throw new InvalidOperationException("Failed to open the EMWaver account page.");
        }
    }

    internal void SignOut()
    {
        _apiKey = null;
        _uid = null;
        _email = null;
        _displayName = null;

        TryRemoveLocalSetting(KeyApiKey);
        TryRemoveLocalSetting(KeyUid);
        TryRemoveLocalSetting(KeyEmail);
        TryRemoveLocalSetting(KeyName);
        TryRemoveLocalSetting(LegacyKeyIdToken);
        TryRemoveLocalSetting(LegacyKeyRefreshToken);
        TryDeletePersisted(PersistFileName);
        TryDeletePersisted(LegacyPersistFileName);

        Changed?.Invoke();
    }

    private Uri BuildAccountManagementUrl()
    {
        var baseUrl = FrontendUrl.Resolve().TrimEnd('/');
        return new Uri($"{baseUrl}/account");
    }

    private async Task<ValidationResult> ValidateApiKeyAsync(string apiKey, CancellationToken ct)
    {
        var url = new Uri(new Uri(_cfg.BackendBaseUrl.TrimEnd('/') + "/"), "v1/auth/key");
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.ParseAdd("application/json");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(json)
                ? $"API key validation failed (HTTP {(int)res.StatusCode})"
                : json);
        }

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("user", out var user) || user.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("API key validation response was missing account identity.");
        }

        var uid = ReadString(user, "uid");
        if (string.IsNullOrWhiteSpace(uid))
        {
            throw new InvalidOperationException("API key validation response was missing account identity.");
        }

        return new ValidationResult(
            Uid: uid,
            Email: ReadString(user, "email"),
            DisplayName: ReadString(user, "name")
        );
    }

    private void PersistCredential()
    {
        TryWriteLocalSetting(KeyApiKey, _apiKey);
        TryWriteLocalSetting(KeyUid, _uid);
        TryWriteLocalSetting(KeyEmail, _email);
        TryWriteLocalSetting(KeyName, _displayName);
        TryRemoveLocalSetting(LegacyKeyIdToken);
        TryRemoveLocalSetting(LegacyKeyRefreshToken);
        TryDeletePersisted(LegacyPersistFileName);
        TrySavePersisted();
    }

    private static string? ReadString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var prop) ? prop.GetString()?.Trim() : null;
    }

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

    private static string PersistPath(string fileName)
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver"
        );
        return Path.Combine(dir, fileName);
    }

    private void TryLoadPersisted()
    {
        try
        {
            var path = PersistPath(PersistFileName);
            if (!File.Exists(path))
            {
                return;
            }

            var json = File.ReadAllText(path);
            var data = JsonSerializer.Deserialize<Persisted>(json);
            if (data != null)
            {
                if (!string.IsNullOrWhiteSpace(data.ApiKey)) _apiKey = data.ApiKey;
                if (!string.IsNullOrWhiteSpace(data.Uid)) _uid = data.Uid;
                if (!string.IsNullOrWhiteSpace(data.Email)) _email = data.Email;
                if (!string.IsNullOrWhiteSpace(data.DisplayName)) _displayName = data.DisplayName;
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
            var path = PersistPath(PersistFileName);
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            var json = JsonSerializer.Serialize(new Persisted(_apiKey, _uid, _email, _displayName));
            File.WriteAllText(path, json);
        }
        catch
        {
        }
    }

    private static void TryDeletePersisted(string fileName)
    {
        try
        {
            var path = PersistPath(fileName);
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
        }
    }
}
