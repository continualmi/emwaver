using EMWaver.Scripting;
using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class RemoteControlClientService
{
    internal interface IDelegate
    {
        void OnStatus(string status);
        void OnAttached(string hostSessionId);
        void OnScriptStarted(string hostSessionId, string scriptInstanceId, string? name);
        void OnUiSnapshot(string hostSessionId, string scriptInstanceId, int rev, ScriptTree? tree);
        void OnError(string message);
    }

    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;

    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;

    private string? _attachedHostId;

    internal IDelegate? Delegate { get; set; }

    internal RemoteControlClientService(CloudConfig cfg, CloudAuthManager auth)
    {
        _cfg = cfg;
        _auth = auth;
    }

    internal void Stop()
    {
        try { _cts?.Cancel(); } catch { }
        _cts = null;
        try { _ws?.Abort(); } catch { }
        _ws = null;
        _attachedHostId = null;
        Delegate?.OnStatus("disconnected");
    }

    internal void ConnectAndAttach(string hostSessionId)
    {
        Stop();
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => ConnectOnceAsync(hostSessionId, _cts.Token));
    }

    internal void RunScript(string name, string source)
    {
        var hostId = _attachedHostId;
        if (string.IsNullOrWhiteSpace(hostId)) return;
        _ = SendJsonAsync(new { type = "script.run", hostSessionId = hostId, name, source }, CancellationToken.None);
    }

    internal void SendUiEvent(string scriptInstanceId, int baseRev, string targetNodeId, string eventName, object? value)
    {
        var hostId = _attachedHostId;
        if (string.IsNullOrWhiteSpace(hostId)) return;

        var payload = new Dictionary<string, object?>();
        if (value != null) payload["value"] = value;

        _ = SendJsonAsync(new
        {
            type = "ui.event",
            hostSessionId = hostId,
            scriptInstanceId,
            baseRev,
            targetNodeId,
            name = eventName,
            payload,
        }, CancellationToken.None);
    }

    private async Task ConnectOnceAsync(string hostSessionId, CancellationToken ct)
    {
        try
        {
            Delegate?.OnStatus("connecting");

            var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
            var tok = _auth.GetIdToken();
            if (string.IsNullOrWhiteSpace(tok) && !allowAnon)
            {
                Delegate?.OnError("missing auth token");
                return;
            }

            var baseUrl = _cfg.BackendBaseUrl?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                Delegate?.OnError("missing backend url");
                return;
            }

            var wsUrl = baseUrl.TrimEnd('/');
            wsUrl = wsUrl.Replace("https://", "wss://").Replace("http://", "ws://");
            wsUrl = wsUrl + "/v1/ws";
            if (!string.IsNullOrWhiteSpace(tok))
            {
                wsUrl += "?token=" + Uri.EscapeDataString(tok.Trim());
            }

            var ws = new ClientWebSocket();
            _ws = ws;
            await ws.ConnectAsync(new Uri(wsUrl), ct);
            Delegate?.OnStatus("open");

            await SendJsonAsync(new { type = "hello", role = "web", protocolVersion = 1 }, ct);
            await SendJsonAsync(new { type = "host.attach", hostSessionId }, ct);

            await ReceiveLoopAsync(ct);
        }
        catch (Exception ex)
        {
            Delegate?.OnStatus("error");
            Delegate?.OnError(ex.Message);
        }
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
                    Delegate?.OnStatus("closed");
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
            var type = root.TryGetProperty("type", out var t) ? (t.GetString() ?? "") : "";

            if (type == "host.attached")
            {
                _attachedHostId = root.TryGetProperty("hostSessionId", out var hid) ? hid.GetString() : _attachedHostId;
                Delegate?.OnAttached(_attachedHostId ?? hostSessionId: "");
                return;
            }

            if (type == "host.error")
            {
                var err = root.TryGetProperty("error", out var e) ? (e.GetString() ?? "error") : "error";
                Delegate?.OnError("host error: " + err);
                return;
            }

            if (type == "script.started")
            {
                var hostId = root.TryGetProperty("hostSessionId", out var hh) ? (hh.GetString() ?? "") : (_attachedHostId ?? "");
                var scriptId = root.TryGetProperty("scriptInstanceId", out var si) ? (si.GetString() ?? "") : "";
                var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                Delegate?.OnScriptStarted(hostId, scriptId, name);
                return;
            }

            if (type == "ui.snapshot")
            {
                var hostId = root.TryGetProperty("hostSessionId", out var hh) ? (hh.GetString() ?? "") : (_attachedHostId ?? "");
                var scriptId = root.TryGetProperty("scriptInstanceId", out var si) ? (si.GetString() ?? "") : "";
                var rev = root.TryGetProperty("rev", out var rr) && rr.TryGetInt32(out var rri) ? rri : 0;

                ScriptTree? tree = null;
                if (root.TryGetProperty("root", out var rootNode) && rootNode.ValueKind == JsonValueKind.Object)
                {
                    var node = DecodeNode(rootNode);
                    if (node != null)
                    {
                        tree = new ScriptTree { Root = node, Metadata = new Dictionary<string, object?>() };
                    }
                }

                Delegate?.OnUiSnapshot(hostId, scriptId, rev, tree);
                return;
            }

            if (type == "script.error")
            {
                var err = root.TryGetProperty("error", out var e) ? (e.GetString() ?? "error") : "error";
                Delegate?.OnError("script error: " + err);
                return;
            }

            if (type == "error")
            {
                var err = root.TryGetProperty("error", out var e) ? (e.GetString() ?? "error") : "error";
                Delegate?.OnError(err);
                return;
            }
        }
        catch
        {
        }
    }

    private static ScriptNode? DecodeNode(JsonElement n)
    {
        try
        {
            var id = n.TryGetProperty("id", out var i) ? (i.GetString() ?? "") : "";
            var typeRaw = n.TryGetProperty("type", out var tr) ? (tr.GetString() ?? "column") : "column";
            if (!ScriptNodeTypeExtensions.TryFromRaw(typeRaw, out var type)) type = ScriptNodeType.Column;

            var raw = new Dictionary<string, object?>();
            if (n.TryGetProperty("props", out var props) && props.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in props.EnumerateObject())
                {
                    raw[p.Name] = p.Value.ToString();
                }
            }

            var handlers = new Dictionary<ScriptEventType, string>();
            if (n.TryGetProperty("handlers", out var hh) && hh.ValueKind == JsonValueKind.Object)
            {
                foreach (var h in hh.EnumerateObject())
                {
                    if (ScriptEventTypeExtensions.TryFromRaw(h.Name, out var ev))
                    {
                        handlers[ev] = h.Value.GetString() ?? "";
                    }
                }
            }

            var kids = new List<ScriptNode>();
            if (n.TryGetProperty("children", out var ch) && ch.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in ch.EnumerateArray())
                {
                    var child = DecodeNode(c);
                    if (child != null) kids.Add(child);
                }
            }

            return new ScriptNode
            {
                Id = id,
                Type = type,
                Props = new ScriptNodeProps(raw, handlers),
                Children = kids,
            };
        }
        catch
        {
            return null;
        }
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
