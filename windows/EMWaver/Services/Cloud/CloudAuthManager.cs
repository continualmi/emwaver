using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;

namespace EMWaver.Services.Cloud;

internal sealed class CloudAuthManager
{
    private const string KeyIdToken = "cloud.firebase.idToken";
    private const string KeyRefreshToken = "cloud.firebase.refreshToken";

    private readonly CloudConfig _cfg;
    private readonly GoogleOAuthPkce _google;
    private readonly FirebaseAuthService _firebase;

    private string? _idToken;
    private string? _refreshToken;

    private sealed record Persisted(string? IdToken, string? RefreshToken);

    internal CloudAuthManager(CloudConfig cfg, GoogleOAuthPkce google, FirebaseAuthService firebase)
    {
        _cfg = cfg;
        _google = google;
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
        var existing = GetIdToken();
        if (!string.IsNullOrWhiteSpace(existing))
        {
            return existing!;
        }

        return await SignInInteractiveAsync(ct);
    }

    internal async Task<string> SignInInteractiveAsync(CancellationToken ct)
    {
        var googleTokens = await _google.AuthorizeAsync(_cfg.GoogleClientId, _cfg.GoogleClientSecret, ct);
        var session = await _firebase.SignInWithGoogleAsync(
            firebaseWebApiKey: _cfg.FirebaseWebApiKey,
            googleIdToken: googleTokens.IdToken,
            googleAccessToken: googleTokens.AccessToken,
            ct: ct
        );

        _idToken = session.IdToken;
        _refreshToken = session.RefreshToken;

        // Best-effort persistence in BOTH contexts:
        // - Packaged apps: ApplicationData.Current.LocalSettings
        // - Unpackaged/dev: LocalAppData json file
        TryWriteLocalSetting(KeyIdToken, _idToken);
        TryWriteLocalSetting(KeyRefreshToken, _refreshToken);
        TrySavePersisted();

        return _idToken ?? "";
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
