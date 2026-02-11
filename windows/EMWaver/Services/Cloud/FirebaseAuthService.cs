using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class FirebaseAuthService
{
    internal sealed record FirebaseSession(string IdToken, string RefreshToken, int ExpiresInSeconds);

    private readonly HttpClient _http;

    internal FirebaseAuthService(HttpClient http)
    {
        _http = http;
    }

    internal async Task<FirebaseSession> SignInWithGoogleAsync(string firebaseWebApiKey, string googleIdToken, string googleAccessToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(firebaseWebApiKey))
        {
            throw new InvalidOperationException("Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)");
        }

        // Firebase Identity Toolkit (REST): accounts:signInWithIdp
        // https://cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithIdp
        // For Firebase Auth, providerId is typically "google.com".
        var url = $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={Uri.EscapeDataString(firebaseWebApiKey)}";

        // postBody is urlencoded, not JSON.
        var postBody = "id_token=" + Uri.EscapeDataString(googleIdToken)
            + "&access_token=" + Uri.EscapeDataString(googleAccessToken)
            + "&providerId=google.com";

        var payload = new
        {
            postBody = postBody,
            requestUri = "http://localhost",
            returnIdpCredential = true,
            returnSecureToken = true,
        };

        var json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var res = await _http.PostAsync(url, content, ct);
        var resJson = await res.Content.ReadAsStringAsync(ct);

        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Firebase signInWithIdp failed: " + resJson);
        }

        using var doc = JsonDocument.Parse(resJson);
        var root = doc.RootElement;

        var idToken = root.TryGetProperty("idToken", out var it) ? it.GetString() : null;
        var refresh = root.TryGetProperty("refreshToken", out var rt) ? rt.GetString() : null;
        var expiresInStr = root.TryGetProperty("expiresIn", out var ex) ? ex.GetString() : null;

        if (string.IsNullOrWhiteSpace(idToken) || string.IsNullOrWhiteSpace(refresh))
        {
            throw new InvalidOperationException("Firebase response missing idToken/refreshToken");
        }

        var expires = 3600;
        if (!string.IsNullOrWhiteSpace(expiresInStr) && int.TryParse(expiresInStr, out var parsed))
        {
            expires = parsed;
        }

        return new FirebaseSession(idToken!, refresh!, expires);
    }

    internal async Task<FirebaseSession> SignInWithCustomTokenAsync(string firebaseWebApiKey, string customToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(firebaseWebApiKey))
        {
            throw new InvalidOperationException("Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)");
        }
        if (string.IsNullOrWhiteSpace(customToken))
        {
            throw new InvalidOperationException("Missing Firebase custom token");
        }

        var url = $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={Uri.EscapeDataString(firebaseWebApiKey)}";
        var payload = new
        {
            token = customToken,
            returnSecureToken = true,
        };

        var json = JsonSerializer.Serialize(payload);
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var res = await _http.PostAsync(url, content, ct);
        var resJson = await res.Content.ReadAsStringAsync(ct);

        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Firebase signInWithCustomToken failed: " + resJson);
        }

        using var doc = JsonDocument.Parse(resJson);
        var root = doc.RootElement;

        var idToken = root.TryGetProperty("idToken", out var it) ? it.GetString() : null;
        var refresh = root.TryGetProperty("refreshToken", out var rt) ? rt.GetString() : null;
        var expiresInStr = root.TryGetProperty("expiresIn", out var ex) ? ex.GetString() : null;

        if (string.IsNullOrWhiteSpace(idToken) || string.IsNullOrWhiteSpace(refresh))
        {
            throw new InvalidOperationException("Firebase response missing idToken/refreshToken");
        }

        var expires = 3600;
        if (!string.IsNullOrWhiteSpace(expiresInStr) && int.TryParse(expiresInStr, out var parsed))
        {
            expires = parsed;
        }

        return new FirebaseSession(idToken!, refresh!, expires);
    }

    internal async Task<FirebaseSession> RefreshIdTokenAsync(string firebaseWebApiKey, string refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(firebaseWebApiKey))
        {
            throw new InvalidOperationException("Missing EMWAVER_FIREBASE_WEB_API_KEY (Firebase Web API key)");
        }
        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            throw new InvalidOperationException("Missing Firebase refresh token");
        }

        var url = $"https://securetoken.googleapis.com/v1/token?key={Uri.EscapeDataString(firebaseWebApiKey)}";
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken
        });

        using var res = await _http.PostAsync(url, content, ct);
        var resJson = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Firebase refresh token exchange failed: " + resJson);
        }

        using var doc = JsonDocument.Parse(resJson);
        var root = doc.RootElement;

        var idToken = root.TryGetProperty("id_token", out var it) ? it.GetString() : null;
        var refresh = root.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
        var expiresInStr = root.TryGetProperty("expires_in", out var ex) ? ex.GetString() : null;

        if (string.IsNullOrWhiteSpace(idToken) || string.IsNullOrWhiteSpace(refresh))
        {
            throw new InvalidOperationException("Firebase refresh response missing id_token/refresh_token");
        }

        var expires = 3600;
        if (!string.IsNullOrWhiteSpace(expiresInStr) && int.TryParse(expiresInStr, out var parsed))
        {
            expires = parsed;
        }

        return new FirebaseSession(idToken!, refresh!, expires);
    }
}
