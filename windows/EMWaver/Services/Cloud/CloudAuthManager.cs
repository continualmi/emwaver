using System;
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

    internal CloudAuthManager(CloudConfig cfg, GoogleOAuthPkce google, FirebaseAuthService firebase)
    {
        _cfg = cfg;
        _google = google;
        _firebase = firebase;
    }

    internal bool IsSignedIn => !string.IsNullOrWhiteSpace(GetIdToken());

    internal string? GetIdToken()
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            return ls.Values.TryGetValue(KeyIdToken, out var v) ? v as string : null;
        }
        catch
        {
            return null;
        }
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
        var googleTokens = await _google.AuthorizeAsync(_cfg.GoogleClientId, ct);
        var session = await _firebase.SignInWithGoogleAsync(
            firebaseWebApiKey: _cfg.FirebaseWebApiKey,
            googleIdToken: googleTokens.IdToken,
            googleAccessToken: googleTokens.AccessToken,
            ct: ct
        );

        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            ls.Values[KeyIdToken] = session.IdToken;
            ls.Values[KeyRefreshToken] = session.RefreshToken;
        }
        catch
        {
            // Best-effort; app still works for this run.
        }

        return session.IdToken;
    }

    internal void SignOut()
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            ls.Values.Remove(KeyIdToken);
            ls.Values.Remove(KeyRefreshToken);
        }
        catch
        {
        }
    }
}
