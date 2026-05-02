using EMWaver.Scripting;
using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class RemoteControlHostService
{
    internal interface IDelegate
    {
        void OnRemoteControlActiveChanged(bool active);
        Task RunRemoteScriptAsync(string source, string? name, string scriptInstanceId);
        Task DispatchRemoteUiEventAsync(string scriptInstanceId, string targetNodeId, string eventName, JsonElement payload);
        ScriptTree? GetActiveScriptTree();
        string GetHostSessionId();
    }

    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;

    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    private volatile bool _remoteControlled;
    private string? _activeScriptInstanceId;
    private int _uiRev;

    private sealed record HostSocketConfig(string WsUrl, string Role);

    internal IDelegate? Delegate { get; set; }

    internal bool IsRemoteControlled => _remoteControlled;

    internal RemoteControlHostService(CloudConfig cfg, CloudAuthManager auth)
    {
        _cfg = cfg;
        _auth = auth;
    }

    internal void Start()
    {
        _cts?.Cancel();
        _cts = new CancellationTokenSource();
        _loop = Task.Run(() => ConnectLoopAsync(_cts.Token));
    }

    internal void Stop()
    {
        try { _cts?.Cancel(); } catch { }
        _cts = null;
        try { _ws?.Abort(); } catch { }
        _ws = null;
        SetRemoteControlled(false);
    }

    private async Task ConnectLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (_ws == null || _ws.State != WebSocketState.Open)
                {
                    await ConnectOnceAsync(ct);
                }
            }
            catch
            {
                // ignore
            }

            try { await Task.Delay(2000, ct); } catch { }
        }
    }

    private async Task ConnectOnceAsync(CancellationToken ct)
    {
        var socketConfig = await ResolveHostSocketConfigAsync();
        if (socketConfig == null) return;

        var hostSessionId = Delegate?.GetHostSessionId() ?? "";
        if (string.IsNullOrWhiteSpace(hostSessionId))
        {
            // Fallback to Cloud HostSessionId.
            hostSessionId = AppServices.HostSession.HostSessionId;
        }

        var ws = new ClientWebSocket();
        _ws = ws;
        await ws.ConnectAsync(new Uri(socketConfig.WsUrl), ct);

        // Hello
        await SendJsonAsync(new
        {
            type = "hello",
            role = socketConfig.Role,
            protocolVersion = 1,
            hostSessionId = hostSessionId,
        }, ct);

        await ReceiveLoopAsync(ct);

        try { ws.Abort(); } catch { }
        _ws = null;
        SetRemoteControlled(false);
    }

    private async Task<HostSocketConfig?> ResolveHostSocketConfigAsync()
    {
        var local = ResolveLocalGatewayWsUrl();
        if (!string.IsNullOrWhiteSpace(local))
        {
            return new HostSocketConfig(local, "app");
        }

        var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
        var tok = await _auth.GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false);
        if (string.IsNullOrWhiteSpace(tok) && !allowAnon)
        {
            return null;
        }

        var baseUrl = _cfg.BackendBaseUrl?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(baseUrl)) return null;

        var wsUrl = baseUrl.TrimEnd('/');
        wsUrl = wsUrl.Replace("https://", "wss://").Replace("http://", "ws://");
        wsUrl = wsUrl + "/v1/ws";
        if (!string.IsNullOrWhiteSpace(tok))
        {
            wsUrl += "?token=" + Uri.EscapeDataString(tok.Trim());
        }

        return new HostSocketConfig(wsUrl, "host");
    }

    private static string? ResolveLocalGatewayWsUrl()
    {
        if ((Environment.GetEnvironmentVariable("EMWAVER_LOCAL_GATEWAY_DISABLED") ?? "") == "1")
        {
            return null;
        }

        var raw = (Environment.GetEnvironmentVariable("EMWAVER_LOCAL_GATEWAY_URL") ?? "").Trim();
        if (string.IsNullOrWhiteSpace(raw))
        {
            raw = "ws://127.0.0.1:3921/v1/ws";
        }

        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            return null;
        }

        var builder = new UriBuilder(uri);
        if (string.Equals(builder.Scheme, "http", StringComparison.OrdinalIgnoreCase))
        {
            builder.Scheme = "ws";
        }
        else if (string.Equals(builder.Scheme, "https", StringComparison.OrdinalIgnoreCase))
        {
            builder.Scheme = "wss";
        }

        if (!string.Equals(builder.Scheme, "ws", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(builder.Scheme, "wss", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(builder.Path) || builder.Path == "/")
        {
            builder.Path = "/v1/ws";
        }

        return builder.Uri.ToString();
    }

    private async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buf = new byte[256 * 1024];
        while (!ct.IsCancellationRequested && _ws != null && _ws.State == WebSocketState.Open)
        {
            WebSocketReceiveResult res;
            var ms = new System.IO.MemoryStream();
            do
            {
                res = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (res.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }
                ms.Write(buf, 0, res.Count);
            } while (!res.EndOfMessage);

            var text = Encoding.UTF8.GetString(ms.ToArray());
            HandleIncoming(text);
        }
    }

    private void HandleIncoming(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var type = root.GetProperty("type").GetString() ?? "";

            if (type == "host.attach")
            {
                SetRemoteControlled(true);
                return;
            }

            if (type == "script.run")
            {
                SetRemoteControlled(true);

                var source = root.TryGetProperty("source", out var s) ? (s.GetString() ?? "") : "";
                var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (string.IsNullOrWhiteSpace(source))
                {
                    _ = SendJsonAsync(new { type = "script.error", error = "missing_source" }, CancellationToken.None);
                    return;
                }

                var instanceId = Guid.NewGuid().ToString();
                _activeScriptInstanceId = instanceId;
                _uiRev = 0;

                var d = Delegate;
                if (d != null)
                {
                    _ = d.RunRemoteScriptAsync(source, name, instanceId);
                }

                _ = SendJsonAsync(new { type = "script.started", scriptInstanceId = instanceId, name = name ?? "" }, CancellationToken.None);
                return;
            }

            if (type == "ui.event")
            {
                var scriptId = root.TryGetProperty("scriptInstanceId", out var si) ? (si.GetString() ?? "") : "";
                if (string.IsNullOrWhiteSpace(scriptId) || scriptId != _activeScriptInstanceId) return;

                var targetNodeId = root.TryGetProperty("targetNodeId", out var tn) ? (tn.GetString() ?? "") : "";
                var name = root.TryGetProperty("name", out var en) ? (en.GetString() ?? "") : "";
                var payload = root.TryGetProperty("payload", out var pl) ? pl : default;

                var d = Delegate;
                if (d != null)
                {
                    _ = d.DispatchRemoteUiEventAsync(scriptId, targetNodeId, name, payload);
                }
                return;
            }
        }
        catch
        {
        }
    }

    private void SetRemoteControlled(bool on)
    {
        if (_remoteControlled == on) return;
        _remoteControlled = on;
        try { Delegate?.OnRemoteControlActiveChanged(on); } catch { }
    }

    internal void PublishUiSnapshotIfRemoteControlled()
    {
        if (!_remoteControlled) return;
        if (string.IsNullOrWhiteSpace(_activeScriptInstanceId)) return;

        var d = Delegate;
        if (d == null) return;
        var tree = d.GetActiveScriptTree();
        if (tree == null) return;

        try
        {
            _uiRev += 1;
            var snap = new
            {
                type = "ui.snapshot",
                hostSessionId = d.GetHostSessionId(),
                scriptInstanceId = _activeScriptInstanceId,
                rev = _uiRev,
                root = EncodeNode(tree.Root),
                metadata = tree.Metadata,
            };

            _ = SendJsonAsync(snap, CancellationToken.None);
        }
        catch
        {
        }
    }

    private static object EncodeNode(ScriptNode node)
    {
        var handlers = new Dictionary<string, string>();
        foreach (var kv in node.Props.EventHandlers)
        {
            handlers[kv.Key.ToRaw()] = kv.Value;
        }

        var kids = new List<object>();
        foreach (var c in node.Children)
        {
            kids.Add(EncodeNode(c));
        }

        return new
        {
            id = node.Id,
            type = node.Type.ToRaw(),
            props = node.Props.Raw,
            handlers = handlers.Count > 0 ? handlers : null,
            children = kids,
        };
    }

    private async Task SendJsonAsync(object obj, CancellationToken ct)
    {
        try
        {
            if (_ws == null || _ws.State != WebSocketState.Open) return;
            var json = JsonSerializer.Serialize(obj);
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
        }
        catch
        {
        }
    }
}
