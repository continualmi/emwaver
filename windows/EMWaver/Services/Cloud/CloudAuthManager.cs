using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;

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

    private string? _apiKey;
    private string? _email;
    private string? _displayName;
    private string? _uid;

    internal event Action? Changed;

    private sealed record Persisted(string? ApiKey, string? Uid, string? Email, string? DisplayName);
    internal CloudAuthManager(CloudConfig cfg)
    {
        _ = cfg;

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

    internal bool HasAgentKey => !string.IsNullOrWhiteSpace(GetIdToken());

    internal bool IsSignedIn => false;

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
        await SignInInteractiveAsync(ct);
        throw new InvalidOperationException("Save an Agent API key in Settings to enable Agent replies.");
    }

    internal async Task<string?> GetValidIdTokenAsync(CancellationToken ct, bool interactiveSignIn)
    {
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
            throw new InvalidOperationException("Enter an Agent API key.");
        }

        await Task.CompletedTask;
        _apiKey = trimmed;
        _uid = "agent-key";
        _email = null;
        _displayName = "Agent key";

        PersistCredential();
        Changed?.Invoke();
        return _apiKey;
    }

    internal async Task SignInInteractiveAsync(CancellationToken ct)
    {
        await Task.CompletedTask;
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
