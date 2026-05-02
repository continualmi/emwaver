using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class GoogleOAuthPkce
{
    internal sealed record GoogleTokens(string AccessToken, string IdToken, int ExpiresInSeconds);

    private readonly HttpClient _http;

    internal GoogleOAuthPkce(HttpClient http)
    {
        _http = http;
    }

    internal async Task<GoogleTokens> AuthorizeAsync(string clientId, string clientSecret, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(clientId))
        {
            throw new InvalidOperationException("Missing EMWAVER_GOOGLE_CLIENT_ID (Google OAuth client id)");
        }

        // Loopback redirect. Works for desktop apps.
        var port = GetRandomUnusedPort();
        var redirectUri = $"http://127.0.0.1:{port}/callback/";

        var verifier = PkceUtil.CreateCodeVerifier();
        var challenge = PkceUtil.CreateCodeChallenge(verifier);

        var state = Guid.NewGuid().ToString("N");

        var authUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
            "?client_id=" + Uri.EscapeDataString(clientId) +
            "&redirect_uri=" + Uri.EscapeDataString(redirectUri) +
            "&response_type=code" +
            "&scope=" + Uri.EscapeDataString("openid email profile") +
            "&code_challenge=" + Uri.EscapeDataString(challenge) +
            "&code_challenge_method=S256" +
            "&access_type=offline" +
            "&prompt=consent" +
            "&state=" + Uri.EscapeDataString(state);

        using var listener = new HttpListener();
        listener.Prefixes.Add(redirectUri);
        listener.Start();

        // Launch browser.
        // Process.Start can throw in some WinAppSDK contexts; prefer Launcher.
        try
        {
            var ok = await Windows.System.Launcher.LaunchUriAsync(new Uri(authUrl));
            if (!ok)
            {
                throw new InvalidOperationException("Failed to launch browser for Google sign-in");
            }
        }
        catch
        {
            // Fallback for environments where Launcher isn't available.
            Process.Start(new ProcessStartInfo
            {
                FileName = authUrl,
                UseShellExecute = true,
            });
        }

        // Wait for the OAuth redirect.
        var ctx = await listener.GetContextAsync().WaitAsync(ct);
        var req = ctx.Request;
        var resp = ctx.Response;

        string html;
        try
        {
            var query = ParseQueryString(req.Url?.Query ?? "");
            if (!query.TryGetValue("state", out var gotState) || !string.Equals(gotState, state, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("OAuth state mismatch");
            }

            if (query.TryGetValue("error", out var err) && !string.IsNullOrWhiteSpace(err))
            {
                throw new InvalidOperationException("OAuth error: " + err);
            }

            if (!query.TryGetValue("code", out var code) || string.IsNullOrWhiteSpace(code))
            {
                throw new InvalidOperationException("Missing OAuth authorization code");
            }

            var tokens = await ExchangeCodeAsync(code, clientId, clientSecret, redirectUri, verifier, ct);
            html = "<html><body><h2>Key saved</h2><p>You can close this window.</p></body></html>";

            await WriteResponseAsync(resp, html);
            return tokens;
        }
        catch (Exception ex)
        {
            html = "<html><body><h2>Sign-in failed</h2><pre>" + WebUtility.HtmlEncode(ex.Message) + "</pre></body></html>";
            await WriteResponseAsync(resp, html);
            throw;
        }
        finally
        {
            try { resp.Close(); } catch { }
            try { listener.Stop(); } catch { }
        }
    }

    private async Task<GoogleTokens> ExchangeCodeAsync(string code, string clientId, string clientSecret, string redirectUri, string verifier, CancellationToken ct)
    {
        var body = new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = verifier,
        };

        // Some OAuth client types still require a client_secret. Desktop+PKCE should not,
        // but allow it as an escape hatch to unblock dev setups.
        if (!string.IsNullOrWhiteSpace(clientSecret))
        {
            body["client_secret"] = clientSecret;
        }

        using var content = new FormUrlEncodedContent(body);
        using var res = await _http.PostAsync("https://oauth2.googleapis.com/token", content, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Google token exchange failed: " + json);
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var access = root.TryGetProperty("access_token", out var a) ? a.GetString() : null;
        var idToken = root.TryGetProperty("id_token", out var i) ? i.GetString() : null;
        var expiresIn = root.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 0;

        if (string.IsNullOrWhiteSpace(access) || string.IsNullOrWhiteSpace(idToken))
        {
            throw new InvalidOperationException("Google token exchange response missing access_token/id_token");
        }

        return new GoogleTokens(access!, idToken!, expiresIn);
    }

    private static int GetRandomUnusedPort()
    {
        // Simple ephemeral bind.
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var p = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return p;
    }

    private static Dictionary<string, string> ParseQueryString(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(query)) return result;
        var q = query;
        if (q.StartsWith("?")) q = q.Substring(1);
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            var k = Uri.UnescapeDataString(kv[0]);
            var v = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            result[k] = v;
        }
        return result;
    }

    private static async Task WriteResponseAsync(HttpListenerResponse resp, string html)
    {
        var bytes = Encoding.UTF8.GetBytes(html);
        resp.StatusCode = 200;
        resp.ContentType = "text/html; charset=utf-8";
        resp.ContentLength64 = bytes.Length;
        await resp.OutputStream.WriteAsync(bytes, 0, bytes.Length);
        await resp.OutputStream.FlushAsync();
    }
}
