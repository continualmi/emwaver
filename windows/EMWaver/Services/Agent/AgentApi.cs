using EMWaver.Services.Cloud;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
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

    internal sealed record ScriptContext(string Name, string Source);

    internal enum StreamEventKind { Delta, Done, Tool, Error }

    internal sealed record StreamEvent(StreamEventKind Kind, string Text, Message? DoneMessage, string? Model);

    private sealed record AgentEndpointRequest(
        [property: JsonPropertyName("mode")] string Mode,
        [property: JsonPropertyName("prompt")] string Prompt,
        [property: JsonPropertyName("script")] ScriptContext? Script,
        [property: JsonPropertyName("runtime")] object? Runtime,
        [property: JsonPropertyName("hardware")] object? Hardware);

    private sealed record AgentEndpointResponse(
        [property: JsonPropertyName("message")] string? Message,
        [property: JsonPropertyName("code")] string? Code,
        [property: JsonPropertyName("patch")] string? Patch,
        [property: JsonPropertyName("warnings")] List<string>? Warnings);

    private readonly HttpClient _http;
    private readonly CloudAuthManager _auth;

    internal AgentApi(HttpClient http, CloudConfig cfg, CloudAuthManager auth)
    {
        _http = http;
        _auth = auth;
    }

    internal Task<List<Conversation>> ListConversationsAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(new List<Conversation>());
    }

    internal Task<Conversation> CreateConversationAsync(string? title, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var trimmed = (title ?? "").Trim();
        if (trimmed.Length > 48)
        {
            trimmed = trimmed[..48].Trim();
        }

        return Task.FromResult(new Conversation(
            Id: Guid.NewGuid().ToString("D"),
            Title: string.IsNullOrWhiteSpace(trimmed) ? "Chat" : trimmed,
            CreatedAtMs: now,
            UpdatedAtMs: now));
    }

    internal Task DeleteConversationAsync(string conversationId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    internal Task<List<Message>> ListMessagesAsync(string conversationId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(new List<Message>());
    }

    internal Task ChatStreamAsync(string conversationId, string message, Action<StreamEvent> onEvent, CancellationToken ct)
    {
        return ChatStreamWithToolsAsync(conversationId, message, null, onEvent, ct);
    }

    internal async Task ChatStreamWithToolsAsync(
        string conversationId,
        string message,
        ScriptContext? script,
        Action<StreamEvent> onEvent,
        CancellationToken ct)
    {
        var endpoint = ResolveEndpoint();
        var key = RequireAgentKey();

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        req.Content = new StringContent(
            JsonSerializer.Serialize(new AgentEndpointRequest(
                Mode: "debug",
                Prompt: message,
                Script: script,
                Runtime: null,
                Hardware: null)),
            Encoding.UTF8,
            "application/json");

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            throw new InvalidOperationException("Saved Agent key is not authorized.");
        }
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(ExtractError(body, (int)res.StatusCode));
        }

        var response = JsonSerializer.Deserialize<AgentEndpointResponse>(body)
            ?? throw new InvalidOperationException("Agent response was empty.");

        var content = FormatResponse(response);
        onEvent(new StreamEvent(
            StreamEventKind.Done,
            "",
            new Message(Guid.NewGuid().ToString("D"), "assistant", content, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
            null));
    }

    private Uri ResolveEndpoint()
    {
        var active = new[]
            {
                Environment.GetEnvironmentVariable("EMWAVER_AGENT_ENDPOINT"),
                Environment.GetEnvironmentVariable("CONTINUAL_AGENT_ENDPOINT"),
            }
            .Select(v => (v ?? "").Trim())
            .FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

        if (string.IsNullOrWhiteSpace(active) || !Uri.TryCreate(active, UriKind.Absolute, out var endpoint))
        {
            throw new InvalidOperationException("Agent endpoint is not configured. Set EMWAVER_AGENT_ENDPOINT.");
        }

        return endpoint;
    }

    private string RequireAgentKey()
    {
        var key = (_auth.GetIdToken() ?? "").Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new InvalidOperationException("Configure an Agent API key to enable Agent replies. Local scripts continue to run without it.");
        }
        return key;
    }

    private static string FormatResponse(AgentEndpointResponse response)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(response.Message))
        {
            parts.Add(response.Message!.Trim());
        }
        if (!string.IsNullOrWhiteSpace(response.Code))
        {
            parts.Add("```emw\n" + response.Code!.Trim() + "\n```");
        }
        if (!string.IsNullOrWhiteSpace(response.Patch))
        {
            parts.Add("Patch:\n" + response.Patch!.Trim());
        }
        if (response.Warnings is { Count: > 0 })
        {
            parts.Add("Warnings:\n" + string.Join("\n", response.Warnings.Where(w => !string.IsNullOrWhiteSpace(w)).Select(w => "- " + w.Trim())));
        }

        return parts.Count > 0 ? string.Join("\n\n", parts) : "Agent returned an empty reply.";
    }

    private static string ExtractError(string body, int statusCode)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("message", out var m))
            {
                var s = m.GetString() ?? "";
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
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
