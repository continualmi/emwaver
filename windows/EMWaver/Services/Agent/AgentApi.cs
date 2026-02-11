using EMWaver.Services.Cloud;
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Agent;

internal sealed class AgentApi
{
    internal sealed record Conversation(string Id, string? Title, long CreatedAtMs, long UpdatedAtMs)
    {
        public string DisplayTitle => !string.IsNullOrWhiteSpace(Title) ? Title!.Trim() : Id;
    }

    internal sealed record Message(string Id, string Role, string Content, long CreatedAtMs);

    internal enum StreamEventKind { Delta, Done, Error }

    internal sealed record StreamEvent(StreamEventKind Kind, string Text, Message? DoneMessage, string? Model);

    private readonly HttpClient _http;
    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;

    internal AgentApi(HttpClient http, CloudConfig cfg, CloudAuthManager auth)
    {
        _http = http;
        _cfg = cfg;
        _auth = auth;
    }

    private Uri Build(string path)
    {
        var baseRaw = (_cfg.BackendBaseUrl ?? "").Trim();
        if (string.IsNullOrWhiteSpace(baseRaw) || !Uri.TryCreate(baseRaw, UriKind.Absolute, out var baseUrl))
        {
            throw new InvalidOperationException("Backend URL is not configured (Settings → Backend).");
        }
        return new Uri(baseUrl, path);
    }

    private string RequireIdToken()
    {
        var tok = _auth.GetIdToken() ?? "";
        if (string.IsNullOrWhiteSpace(tok))
        {
            throw new InvalidOperationException("Please sign in to chat.");
        }
        return tok;
    }

    internal async Task<List<Conversation>> ListConversationsAsync(CancellationToken ct)
    {
        var tok = RequireIdToken();
        using var req = new HttpRequestMessage(HttpMethod.Get, Build("/v1/agent/conversations"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new InvalidOperationException("Unauthorized");
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));

        using var doc = JsonDocument.Parse(body);
        var list = new List<Conversation>();
        if (doc.RootElement.TryGetProperty("conversations", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in arr.EnumerateArray())
            {
                list.Add(new Conversation(
                    Id: el.GetProperty("id").GetString() ?? "",
                    Title: el.TryGetProperty("title", out var t) ? t.GetString() : null,
                    CreatedAtMs: el.TryGetProperty("created_at_ms", out var c) ? c.GetInt64() : 0,
                    UpdatedAtMs: el.TryGetProperty("updated_at_ms", out var u) ? u.GetInt64() : 0
                ));
            }
        }
        return list;
    }

    internal async Task<Conversation> CreateConversationAsync(string? title, CancellationToken ct)
    {
        var tok = RequireIdToken();
        using var req = new HttpRequestMessage(HttpMethod.Post, Build("/v1/agent/conversations"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);
        req.Content = new StringContent(JsonSerializer.Serialize(new { title = (title ?? "").Trim() }), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new InvalidOperationException("Unauthorized");
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));

        using var doc = JsonDocument.Parse(body);
        var c = doc.RootElement.GetProperty("conversation");
        return new Conversation(
            Id: c.GetProperty("id").GetString() ?? "",
            Title: c.TryGetProperty("title", out var t) ? t.GetString() : null,
            CreatedAtMs: c.TryGetProperty("created_at_ms", out var cr) ? cr.GetInt64() : 0,
            UpdatedAtMs: c.TryGetProperty("updated_at_ms", out var up) ? up.GetInt64() : 0
        );
    }

    internal async Task DeleteConversationAsync(string conversationId, CancellationToken ct)
    {
        var tok = RequireIdToken();
        using var req = new HttpRequestMessage(HttpMethod.Delete, Build($"/v1/agent/conversations/{conversationId}"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new InvalidOperationException("Unauthorized");
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));
    }

    internal async Task<List<Message>> ListMessagesAsync(string conversationId, CancellationToken ct)
    {
        var tok = RequireIdToken();
        using var req = new HttpRequestMessage(HttpMethod.Get, Build($"/v1/agent/conversations/{conversationId}/messages"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new InvalidOperationException("Unauthorized");
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));

        using var doc = JsonDocument.Parse(body);
        var outList = new List<Message>();
        if (doc.RootElement.TryGetProperty("messages", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in arr.EnumerateArray())
            {
                outList.Add(new Message(
                    Id: el.TryGetProperty("id", out var i) ? (i.GetString() ?? "") : "",
                    Role: el.TryGetProperty("role", out var r) ? (r.GetString() ?? "assistant") : "assistant",
                    Content: el.TryGetProperty("content", out var c) ? (c.GetString() ?? "") : "",
                    CreatedAtMs: el.TryGetProperty("created_at_ms", out var m) ? m.GetInt64() : 0
                ));
            }
        }
        return outList;
    }

    internal async Task ChatStreamAsync(string conversationId, string message, Action<StreamEvent> onEvent, CancellationToken ct)
    {
        var tok = RequireIdToken();

        using var req = new HttpRequestMessage(HttpMethod.Post, Build("/v1/agent/chat/stream"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tok);
        req.Content = new StringContent(JsonSerializer.Serialize(new { conversation_id = conversationId, message }), Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) throw new InvalidOperationException("Unauthorized");

        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));
        }

        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        var block = new StringBuilder();
        while (!reader.EndOfStream && !ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync();
            if (line == null) break;

            if (line.Length == 0)
            {
                ParseBlock(block.ToString(), onEvent);
                block.Clear();
            }
            else
            {
                block.Append(line).Append('\n');
            }
        }

        if (block.Length > 0)
        {
            ParseBlock(block.ToString(), onEvent);
        }
    }

    private static void ParseBlock(string raw, Action<StreamEvent> onEvent)
    {
        var trimmed = (raw ?? "").Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) return;

        var ev = "message";
        var dataLines = new List<string>();

        foreach (var ln in trimmed.Split('\n'))
        {
            if (ln.StartsWith("event:")) ev = ln.Substring("event:".Length).Trim();
            else if (ln.StartsWith("data:")) dataLines.Add(ln.Substring("data:".Length).Trim());
        }

        var dataRaw = string.Join("\n", dataLines).Trim();
        if (string.IsNullOrWhiteSpace(dataRaw)) return;

        try
        {
            using var doc = JsonDocument.Parse(dataRaw);
            if (ev == "delta")
            {
                var t = doc.RootElement.TryGetProperty("text", out var te) ? (te.GetString() ?? "") : "";
                onEvent(new StreamEvent(StreamEventKind.Delta, t, null, null));
                return;
            }

            if (ev == "error")
            {
                var e = doc.RootElement.TryGetProperty("error", out var er) ? (er.GetString() ?? "error") : "error";
                onEvent(new StreamEvent(StreamEventKind.Error, e, null, null));
                return;
            }

            if (ev == "done")
            {
                var msg = doc.RootElement.GetProperty("message");
                var m = new Message(
                    Id: msg.TryGetProperty("id", out var i) ? (i.GetString() ?? "") : "",
                    Role: msg.TryGetProperty("role", out var r) ? (r.GetString() ?? "assistant") : "assistant",
                    Content: msg.TryGetProperty("content", out var c) ? (c.GetString() ?? "") : "",
                    CreatedAtMs: msg.TryGetProperty("created_at_ms", out var ms) ? ms.GetInt64() : 0
                );
                var model = doc.RootElement.TryGetProperty("model", out var mo) ? mo.GetString() : null;
                onEvent(new StreamEvent(StreamEventKind.Done, "", m, model));
            }
        }
        catch
        {
            // Ignore parse errors.
        }
    }

    private static string ExtractError(string body, int statusCode)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var e))
            {
                var s = e.GetString() ?? "";
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
        }
        catch { }

        var t = (body ?? "").Trim();
        return !string.IsNullOrWhiteSpace(t) ? t : ("HTTP " + statusCode);
    }
}
