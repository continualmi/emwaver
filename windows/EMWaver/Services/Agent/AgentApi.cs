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
using EMWaver;

namespace EMWaver.Services.Agent;

public sealed class AgentApi
{
    private const string DefaultMgptResponsesEndpoint = "https://mdl.continualmi.com/api/mgpt/responses";

    internal sealed record Conversation(string Id, string? Title, long CreatedAtMs, long UpdatedAtMs)
    {
        public string DisplayTitle => !string.IsNullOrWhiteSpace(Title) ? Title!.Trim() : Id;
    }

    internal sealed record Message(string Id, string Role, string Content, long CreatedAtMs);

    internal sealed record ScriptContext(string Name, string Source, string? ToolContext = null);

    internal enum StreamEventKind { Delta, Done, Tool, Error }

    internal sealed record StreamEvent(StreamEventKind Kind, string Text, Message? DoneMessage, string? Model);

    private sealed record AgentEndpointRequest(
        [property: JsonPropertyName("universe")] string? Universe,
        [property: JsonPropertyName("userInput")] string UserInput);

    private sealed record AgentEndpointResponse(
        [property: JsonPropertyName("message")] string? Message,
        [property: JsonPropertyName("code")] string? Code,
        [property: JsonPropertyName("patch")] string? Patch,
        [property: JsonPropertyName("warnings")] List<string>? Warnings);

    private readonly HttpClient _http;
    private readonly AgentApiKeyStore _keys;
    private readonly AgentChatStore _store;

    internal AgentApi(HttpClient http, AgentApiKeyStore keys)
    {
        _http = http;
        _keys = keys;
        _store = AppServices.AgentChats;
    }

    internal Task<List<Conversation>> ListConversationsAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListConversations());
    }

    internal Task<Conversation> CreateConversationAsync(string? title, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.CreateConversation(title));
    }

    internal Task DeleteConversationAsync(string conversationId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _store.ArchiveConversation(conversationId);
        return Task.CompletedTask;
    }

    internal Task<List<Message>> ListMessagesAsync(string conversationId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListMessages(conversationId));
    }

    internal Task ChatStreamAsync(string conversationId, string message, Action<StreamEvent> onEvent, CancellationToken ct)
    {
        return ChatStreamWithToolsAsync(conversationId, message, null, onEvent, ct);
    }

    public async Task<string> SendMessageAsync(string conversationId, string message, string scriptSource)
    {
        string response = string.Empty;
        await ChatStreamWithToolsAsync(
            conversationId,
            message,
            new ScriptContext("current-script.js", scriptSource ?? string.Empty),
            ev =>
            {
                if (ev.Kind == StreamEventKind.Done && ev.DoneMessage is not null)
                {
                    response = ev.DoneMessage.Content;
                }
                else if (ev.Kind == StreamEventKind.Delta || ev.Kind == StreamEventKind.Tool)
                {
                    response += ev.Text;
                }
                else if (ev.Kind == StreamEventKind.Error)
                {
                    response = ev.Text;
                }
            },
            CancellationToken.None);
        return response;
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
        _store.AppendMessage(conversationId, "user", message);

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        req.Content = new StringContent(
            JsonSerializer.Serialize(new AgentEndpointRequest(
                Universe: ResolveUniverse(),
                UserInput: BuildUserInput(message, script))),
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
        var doneMessage = _store.AppendMessage(conversationId, "assistant", content);
        onEvent(new StreamEvent(
            StreamEventKind.Done,
            "",
            doneMessage,
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

        if (string.IsNullOrWhiteSpace(active))
        {
            active = DefaultMgptResponsesEndpoint;
        }

        if (!Uri.TryCreate(active, UriKind.Absolute, out var endpoint))
        {
            throw new InvalidOperationException("Agent endpoint is invalid. Set EMWAVER_AGENT_ENDPOINT to the public MGPT /api/mgpt/responses route.");
        }

        return endpoint;
    }

    private static string BuildUserInput(string message, ScriptContext? script)
    {
        var text = (message ?? "").Trim();
        if (script is null || string.IsNullOrWhiteSpace(script.Source))
        {
            return text;
        }

        var name = string.IsNullOrWhiteSpace(script.Name) ? "script.js" : script.Name.Trim();
        var parts = new List<string> { text };
        if (!string.IsNullOrWhiteSpace(script.ToolContext))
        {
            parts.Add(script.ToolContext!.Trim());
        }
        parts.Add("Script `" + name + "`:\n```emw\n" + script.Source.Trim() + "\n```");
        return string.Join("\n\n", parts);
    }

    private static string? ResolveUniverse()
    {
        var active = new[]
            {
                Environment.GetEnvironmentVariable("EMWAVER_AGENT_UNIVERSE"),
                Environment.GetEnvironmentVariable("CONTINUAL_AGENT_UNIVERSE"),
            }
            .Select(v => (v ?? "").Trim())
            .FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

        return string.IsNullOrWhiteSpace(active) ? null : active;
    }

    private string RequireAgentKey()
    {
        var key = (_keys.GetApiKey() ?? "").Trim();
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
