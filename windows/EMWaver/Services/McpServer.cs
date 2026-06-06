using EMWaver.Models;
using EMWaver.Scripting;
using System;
using System.Buffers;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace EMWaver.Services;

public sealed class McpServer : IDisposable
{
    private const string EndpointPath = "/mcp";
    private const string FallbackProtocolVersion = "2025-06-18";

    private readonly AppSettings _settings;
    private readonly ScriptRepository _scripts;
    private readonly WindowsDeviceManager _device;
    private readonly ConcurrentDictionary<string, McpScriptRun> _runs = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _lifecycleLock = new();
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;
    private Task? _listenTask;

    public McpServer(AppSettings settings, ScriptRepository scripts, WindowsDeviceManager device)
    {
        _settings = settings;
        _scripts = scripts;
        _device = device;
    }

    public bool IsRunning { get; private set; }
    public string? LastErrorText { get; private set; }

    public string EndpointUrl => $"http://127.0.0.1:{_settings.McpServerPort}{EndpointPath}";

    public void SyncWithSettings()
    {
        if (_settings.McpServerEnabled)
        {
            Start();
        }
        else
        {
            Stop();
        }
    }

    public void Start()
    {
        lock (_lifecycleLock)
        {
            if (IsRunning) return;

            try
            {
                _cts = new CancellationTokenSource();
                _listener = new TcpListener(IPAddress.Loopback, _settings.McpServerPort);
                _listener.Start();
                LastErrorText = null;
                IsRunning = true;
                _listenTask = Task.Run(() => ListenAsync(_cts.Token));
            }
            catch (Exception ex)
            {
                LastErrorText = ex.Message;
                IsRunning = false;
                try { _listener?.Stop(); } catch { }
                _listener = null;
                _cts?.Dispose();
                _cts = null;
                _listenTask = null;
            }
        }
    }

    public void Stop()
    {
        lock (_lifecycleLock)
        {
            if (!IsRunning) return;
            IsRunning = false;
            _cts?.Cancel();
            try { _listener?.Stop(); } catch { }
            _listener = null;
            _cts?.Dispose();
            _cts = null;
            _listenTask = null;
        }
    }

    public void Dispose()
    {
        Stop();
        foreach (var run in _runs.Values)
        {
            run.Dispose();
        }
        _runs.Clear();
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            TcpClient? client = null;
            try
            {
                var listener = _listener;
                if (listener == null) return;
                client = await listener.AcceptTcpClientAsync(cancellationToken);
                _ = Task.Run(() => HandleClientAsync(client, cancellationToken), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                client?.Dispose();
                return;
            }
            catch
            {
                client?.Dispose();
                if (!IsRunning) return;
                await Task.Delay(250, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private async Task HandleClientAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using var _ = client;
        try
        {
            using var stream = client.GetStream();
            var request = await ReadHttpRequestAsync(stream, cancellationToken).ConfigureAwait(false);
            if (request == null)
            {
                return;
            }

            if (!string.Equals(request.Method, "POST", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(request.Path, EndpointPath, StringComparison.OrdinalIgnoreCase))
            {
                await WriteResponseAsync(stream, 404, "Not Found", JsonError(null, -32004, "Unknown MCP endpoint"), cancellationToken).ConfigureAwait(false);
                return;
            }

            if (!IsAuthorized(request))
            {
                await WriteResponseAsync(stream, 401, "Unauthorized", JsonError(null, -32001, "MCP bearer token is required"), cancellationToken).ConfigureAwait(false);
                return;
            }

            var response = await HandleJsonRpcAsync(request.Body).ConfigureAwait(false);
            if (response.StatusCode == 202)
            {
                await WriteEmptyResponseAsync(stream, 202, "Accepted", cancellationToken).ConfigureAwait(false);
                return;
            }

            await WriteResponseAsync(stream, response.StatusCode, "OK", response.Body, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            try
            {
                using var stream = client.GetStream();
                await WriteResponseAsync(stream, 500, "Internal Server Error", JsonError(null, -32603, ex.Message), cancellationToken).ConfigureAwait(false);
            }
            catch { }
        }
    }

    private bool IsAuthorized(HttpRequest request)
    {
        if (!request.Headers.TryGetValue("authorization", out var authorization))
        {
            return false;
        }

        var prefix = "Bearer ";
        return authorization.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && string.Equals(authorization[prefix.Length..].Trim(), _settings.McpServerToken, StringComparison.Ordinal);
    }

    private async Task<McpHttpResponse> HandleJsonRpcAsync(byte[] body)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(body);
        }
        catch
        {
            return new McpHttpResponse(200, JsonError(null, -32700, "Invalid JSON request"));
        }

        if (node is JsonArray batch)
        {
            var responses = new JsonArray();
            foreach (var item in batch)
            {
                if (item is JsonObject obj)
                {
                    var response = await HandleSingleJsonRpcAsync(obj).ConfigureAwait(false);
                    if (response != null)
                    {
                        responses.Add(response);
                    }
                }
            }
            return new McpHttpResponse(responses.Count == 0 ? 202 : 200, JsonSerializer.SerializeToUtf8Bytes(responses));
        }

        if (node is not JsonObject request)
        {
            return new McpHttpResponse(200, JsonError(null, -32600, "JSON-RPC request must be an object"));
        }

        var single = await HandleSingleJsonRpcAsync(request).ConfigureAwait(false);
        return single == null
            ? new McpHttpResponse(202, Array.Empty<byte>())
            : new McpHttpResponse(200, JsonSerializer.SerializeToUtf8Bytes(single));
    }

    private async Task<JsonObject?> HandleSingleJsonRpcAsync(JsonObject request)
    {
        var id = request["id"]?.DeepClone();
        var method = request["method"]?.GetValue<string>();
        var isNotification = request["id"] == null;

        if (string.IsNullOrWhiteSpace(method))
        {
            return RpcError(id, -32600, "Missing JSON-RPC method");
        }

        if (isNotification)
        {
            return null;
        }

        try
        {
            return method switch
            {
                "initialize" => RpcResult(id, InitializeResult(request["params"] as JsonObject)),
                "tools/list" => RpcResult(id, ToolsListResult()),
                "tools/call" => RpcResult(id, await ToolsCallResultAsync(request["params"] as JsonObject).ConfigureAwait(false)),
                _ => RpcError(id, -32601, $"Unsupported MCP method: {method}"),
            };
        }
        catch (Exception ex)
        {
            return RpcError(id, -32603, ex.Message);
        }
    }

    private JsonObject InitializeResult(JsonObject? parameters)
    {
        var protocolVersion = parameters?["protocolVersion"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(protocolVersion))
        {
            protocolVersion = FallbackProtocolVersion;
        }

        return new JsonObject
        {
            ["protocolVersion"] = protocolVersion,
            ["capabilities"] = new JsonObject
            {
                ["tools"] = new JsonObject()
            },
            ["serverInfo"] = new JsonObject
            {
                ["name"] = "EMWaver Windows",
                ["version"] = AppBuildInfo.Version
            }
        };
    }

    private JsonObject ToolsListResult()
    {
        return new JsonObject
        {
            ["tools"] = new JsonArray
            {
                Tool("list_scripts", "List bundled and local JavaScript scripts visible to the Windows app.", EmptySchema()),
                Tool("read_script", "Read one script by script_id from the same roots used by the app UI.", ObjectSchema(new Dictionary<string, JsonNode?>
                {
                    ["script_id"] = new JsonObject { ["type"] = "string" }
                }, required: ["script_id"])),
                Tool("write_script", "Create or update a local JavaScript script in the Windows app script folder.", ObjectSchema(new Dictionary<string, JsonNode?>
                {
                    ["script_id"] = new JsonObject { ["type"] = "string" },
                    ["path"] = new JsonObject { ["type"] = "string" },
                    ["content"] = new JsonObject { ["type"] = "string" }
                }, required: ["content"])),
                Tool("run_script", "Run a JavaScript script through the Windows app script engine.", ObjectSchema(new Dictionary<string, JsonNode?>
                {
                    ["script_id"] = new JsonObject { ["type"] = "string" },
                    ["source"] = new JsonObject { ["type"] = "string" },
                    ["name"] = new JsonObject { ["type"] = "string" }
                }, required: [])),
                Tool("stop_script", "Stop an MCP-started Windows script run.", ObjectSchema(new Dictionary<string, JsonNode?>
                {
                    ["run_id"] = new JsonObject { ["type"] = "string" }
                }, required: [])),
                Tool("device_state", "Return current EMWaver device, transport, firmware, and discovery state.", EmptySchema())
            }
        };
    }

    private async Task<JsonObject> ToolsCallResultAsync(JsonObject? parameters)
    {
        var name = parameters?["name"]?.GetValue<string>();
        var arguments = parameters?["arguments"] as JsonObject;
        JsonObject structured = name switch
        {
            "list_scripts" => await ListScriptsToolAsync().ConfigureAwait(false),
            "read_script" => await ReadScriptToolAsync(arguments).ConfigureAwait(false),
            "write_script" => await WriteScriptToolAsync(arguments).ConfigureAwait(false),
            "run_script" => await RunScriptToolAsync(arguments).ConfigureAwait(false),
            "stop_script" => StopScriptTool(arguments),
            "device_state" => DeviceStateTool(),
            _ => ToolError("unsupported_tool", $"Unsupported MCP tool: {name ?? "<missing>"}")
        };

        return new JsonObject
        {
            ["content"] = new JsonArray
            {
                new JsonObject
                {
                    ["type"] = "text",
                    ["text"] = structured.ToJsonString(new JsonSerializerOptions { WriteIndented = false })
                }
            },
            ["structuredContent"] = structured.DeepClone()
        };
    }

    private async Task<JsonObject> ListScriptsToolAsync()
    {
        var scripts = await _scripts.ListScriptsAsync().ConfigureAwait(false);
        return new JsonObject
        {
            ["ok"] = true,
            ["scripts"] = new JsonArray(scripts.Select(ScriptJson).ToArray<JsonNode?>())
        };
    }

    private async Task<JsonObject> ReadScriptToolAsync(JsonObject? arguments)
    {
        var scriptId = arguments?["script_id"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(scriptId))
        {
            return ToolError("missing_script_id", "read_script requires script_id", "Call list_scripts first and pass one returned script id.");
        }

        var scripts = await _scripts.ListScriptsAsync().ConfigureAwait(false);
        var script = scripts.FirstOrDefault(s => string.Equals(ScriptId(s), scriptId, StringComparison.OrdinalIgnoreCase));
        if (script == null)
        {
            return ToolError("script_not_found", $"Script not found: {scriptId}", "Call list_scripts again; the script may have been renamed or deleted.");
        }

        var source = await _scripts.ReadScriptTextAsync(script).ConfigureAwait(false);
        var scriptJson = ScriptJson(script);
        scriptJson["source"] = source;
        return new JsonObject
        {
            ["ok"] = true,
            ["script"] = scriptJson
        };
    }

    private async Task<JsonObject> WriteScriptToolAsync(JsonObject? arguments)
    {
        var content = arguments?["content"]?.GetValue<string>();
        if (content == null)
        {
            return ToolError("missing_content", "write_script requires content");
        }

        var scripts = (await _scripts.ListScriptsAsync().ConfigureAwait(false)).ToList();
        var scriptId = arguments?["script_id"]?.GetValue<string>();
        ScriptInfo? target = null;

        if (!string.IsNullOrWhiteSpace(scriptId))
        {
            target = scripts.FirstOrDefault(s => string.Equals(ScriptId(s), scriptId, StringComparison.OrdinalIgnoreCase));
            if (target == null)
            {
                return ToolError("script_not_found", $"Script not found: {scriptId}", "Call list_scripts again; the script may have been renamed or deleted.");
            }
            if (target.IsBundled)
            {
                return ToolError("script_read_only", "Bundled scripts are read-only", "Create a local script with path and content, or copy the bundled script in the app UI first.");
            }

            await _scripts.SaveScriptTextAsync(target, content).ConfigureAwait(false);
            _scripts.RefreshAll();
            return new JsonObject
            {
                ["ok"] = true,
                ["created"] = false,
                ["script"] = ScriptJson(target)
            };
        }

        var requestedPath = arguments?["path"]?.GetValue<string>();
        var fileName = LocalScriptFileName(requestedPath);
        target = scripts.FirstOrDefault(s => !s.IsBundled && string.Equals(s.FileName, fileName, StringComparison.OrdinalIgnoreCase));
        if (target != null)
        {
            await _scripts.SaveScriptTextAsync(target, content).ConfigureAwait(false);
            _scripts.RefreshAll();
            return new JsonObject
            {
                ["ok"] = true,
                ["created"] = false,
                ["script"] = ScriptJson(target)
            };
        }

        var created = await _scripts.CreateLocalScriptAsync(fileName, content).ConfigureAwait(false);
        _scripts.RefreshAll();
        return new JsonObject
        {
            ["ok"] = true,
            ["created"] = true,
            ["script"] = ScriptJson(created)
        };
    }

    private async Task<JsonObject> RunScriptToolAsync(JsonObject? arguments)
    {
        var resolved = await ResolveRunSourceAsync(arguments).ConfigureAwait(false);
        if (!resolved.Ok)
        {
            return ToolError(resolved.ErrorCode ?? "script_unavailable", resolved.ErrorMessage ?? "Script unavailable", resolved.Recovery);
        }

        var runId = Guid.NewGuid().ToString("N");
        var run = new McpScriptRun(runId, resolved.Name ?? "MCP Script");
        _runs[runId] = run;

        var completed = new ManualResetEventSlim(false);
        run.Engine.Setup(
            renderHandler: _ => run.RecordRender(),
            sendPacket: (payload, timeoutMs) => _device.SendPacket(payload, timeoutMs),
            errorHandler: run.RecordError,
            consoleHandler: run.RecordConsole,
            getBoardType: () => _device.ConnectedBoardType ?? _device.LastDetectedBoardType);

        run.Engine.Execute(resolved.Source ?? string.Empty, () => completed.Set());
        completed.Wait(TimeSpan.FromMilliseconds(750));
        if (run.HasError)
        {
            run.Status = "failed";
        }

        return new JsonObject
        {
            ["ok"] = !run.HasError,
            ["run_id"] = runId,
            ["status"] = run.Status,
            ["name"] = run.Name,
            ["render_count"] = run.RenderCount,
            ["console"] = run.ConsoleJson(),
            ["error"] = run.ErrorJson()
        };
    }

    private JsonObject StopScriptTool(JsonObject? arguments)
    {
        var runId = arguments?["run_id"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(runId))
        {
            var stopped = 0;
            foreach (var pair in _runs.ToArray())
            {
                if (_runs.TryRemove(pair.Key, out var run))
                {
                    run.Stop();
                    run.Dispose();
                    stopped++;
                }
            }
            return new JsonObject
            {
                ["ok"] = true,
                ["status"] = "stopped",
                ["stopped"] = stopped
            };
        }

        if (!_runs.TryRemove(runId, out var target))
        {
            return ToolError("run_not_found", $"MCP script run not found: {runId}", "Call run_script first, or omit run_id to stop all MCP-started runs.");
        }

        target.Stop();
        var result = new JsonObject
        {
            ["ok"] = true,
            ["run_id"] = target.Id,
            ["status"] = target.Status,
            ["console"] = target.ConsoleJson(),
            ["error"] = target.ErrorJson()
        };
        target.Dispose();
        return result;
    }

    private async Task<ResolvedRunSource> ResolveRunSourceAsync(JsonObject? arguments)
    {
        var source = arguments?["source"]?.GetValue<string>();
        var name = arguments?["name"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(source))
        {
            return ResolvedRunSource.Success(source, string.IsNullOrWhiteSpace(name) ? "MCP Script" : name);
        }

        var scriptId = arguments?["script_id"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(scriptId))
        {
            return ResolvedRunSource.Failure("missing_script", "run_script requires script_id or source", "Call list_scripts first, or pass source directly.");
        }

        var scripts = await _scripts.ListScriptsAsync().ConfigureAwait(false);
        var script = scripts.FirstOrDefault(s => string.Equals(ScriptId(s), scriptId, StringComparison.OrdinalIgnoreCase));
        if (script == null)
        {
            return ResolvedRunSource.Failure("script_not_found", $"Script not found: {scriptId}", "Call list_scripts again; the script may have been renamed or deleted.");
        }

        return ResolvedRunSource.Success(await _scripts.ReadScriptTextAsync(script).ConfigureAwait(false), script.DisplayName);
    }

    private JsonObject DeviceStateTool()
    {
        JsonObject Build()
        {
            var devices = new JsonArray();
            foreach (var port in _device.AvailablePorts)
            {
                devices.Add(new JsonObject
                {
                    ["id"] = $"usb:{port.InDeviceId}",
                    ["name"] = port.DisplayName,
                    ["transport"] = "USB",
                    ["connected"] = _device.ConnectedPort != null && string.Equals(_device.ConnectedPort.InDeviceId, port.InDeviceId, StringComparison.OrdinalIgnoreCase)
                });
            }

            foreach (var ble in _device.BleDiscoveredDevices)
            {
                devices.Add(new JsonObject
                {
                    ["id"] = $"ble:{ble.Id}",
                    ["name"] = ble.DisplayName,
                    ["transport"] = "BLE",
                    ["board_type"] = ble.BoardType,
                    ["connected"] = _device.IsConnected && _device.ActiveTransport == DeviceTransport.Ble
                });
            }

            foreach (var wifi in _device.WiFiDiscoveredDevices)
            {
                devices.Add(new JsonObject
                {
                    ["id"] = $"wifi:{wifi.Id}",
                    ["name"] = wifi.DisplayName,
                    ["transport"] = "Wi-Fi",
                    ["host"] = wifi.Host,
                    ["port"] = wifi.Port,
                    ["board_type"] = wifi.BoardType,
                    ["firmware_version"] = wifi.FirmwareVersion,
                    ["connected"] = _device.IsConnected && _device.ActiveTransport == DeviceTransport.Wifi
                });
            }

            return new JsonObject
            {
                ["ok"] = true,
                ["connected"] = _device.IsConnected,
                ["mode"] = _device.Mode.ToString(),
                ["transport"] = _device.ActiveTransport.ToString(),
                ["board_type"] = _device.ConnectedBoardType ?? _device.LastDetectedBoardType,
                ["firmware_version"] = _device.DeviceEmwaverVersion,
                ["last_error"] = _device.LastErrorText,
                ["selected_device"] = _device.ConnectedPort == null ? null : new JsonObject
                {
                    ["id"] = $"usb:{_device.ConnectedPort.InDeviceId}",
                    ["name"] = _device.ConnectedPort.DisplayName,
                    ["transport"] = _device.ActiveTransport.ToString()
                },
                ["devices"] = devices
            };
        }

        var dispatcher = Application.Current?.Dispatcher;
        return dispatcher == null || dispatcher.CheckAccess()
            ? Build()
            : dispatcher.Invoke(Build);
    }

    private static JsonObject ScriptJson(ScriptInfo script)
    {
        return new JsonObject
        {
            ["id"] = ScriptId(script),
            ["name"] = script.DisplayName,
            ["path"] = script.FilePath,
            ["editable"] = !script.IsBundled,
            ["source_kind"] = script.KindLabel.ToLowerInvariant().Replace(" ", "_")
        };
    }

    private static string ScriptId(ScriptInfo script) => $"{(script.IsBundled ? "bundled" : "local")}:{script.FileName}";

    private static string LocalScriptFileName(string? requestedPath)
    {
        var raw = string.IsNullOrWhiteSpace(requestedPath) ? "mcp-script.js" : Path.GetFileName(requestedPath.Trim());
        if (string.IsNullOrWhiteSpace(raw))
        {
            raw = "mcp-script.js";
        }
        return raw.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ? raw : raw + ".js";
    }

    private static JsonObject Tool(string name, string description, JsonObject inputSchema)
    {
        return new JsonObject
        {
            ["name"] = name,
            ["description"] = description,
            ["inputSchema"] = inputSchema
        };
    }

    private static JsonObject EmptySchema() => ObjectSchema(new Dictionary<string, JsonNode?>(), Array.Empty<string>());

    private static JsonObject ObjectSchema(Dictionary<string, JsonNode?> properties, IReadOnlyList<string> required)
    {
        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject(properties),
            ["required"] = new JsonArray(required.Select(name => JsonValue.Create(name)).ToArray<JsonNode?>()),
            ["additionalProperties"] = false
        };
    }

    private static JsonObject ToolError(string code, string message, string? recovery = null)
    {
        var error = new JsonObject
        {
            ["code"] = code,
            ["message"] = message
        };
        if (!string.IsNullOrWhiteSpace(recovery))
        {
            error["recovery"] = recovery;
        }
        return new JsonObject
        {
            ["ok"] = false,
            ["error"] = error
        };
    }

    private static JsonObject RpcResult(JsonNode? id, JsonObject result)
    {
        return new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id,
            ["result"] = result
        };
    }

    private static JsonObject RpcError(JsonNode? id, int code, string message)
    {
        return new JsonObject
        {
            ["jsonrpc"] = "2.0",
            ["id"] = id,
            ["error"] = new JsonObject
            {
                ["code"] = code,
                ["message"] = message
            }
        };
    }

    private static byte[] JsonError(JsonNode? id, int code, string message)
    {
        return JsonSerializer.SerializeToUtf8Bytes(RpcError(id, code, message));
    }

    private static async Task<HttpRequest?> ReadHttpRequestAsync(NetworkStream stream, CancellationToken cancellationToken)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(8192);
        try
        {
            using var memory = new MemoryStream();
            var headerEnd = -1;
            while (headerEnd < 0)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
                if (read == 0) return null;
                memory.Write(buffer, 0, read);
                var bytes = memory.ToArray();
                headerEnd = FindHeaderEnd(bytes);
                if (memory.Length > 1024 * 1024)
                {
                    throw new InvalidOperationException("HTTP request headers are too large");
                }
            }

            var all = memory.ToArray();
            var headerText = Encoding.ASCII.GetString(all, 0, headerEnd);
            var lines = headerText.Split("\r\n", StringSplitOptions.None);
            var requestLine = lines.FirstOrDefault()?.Split(' ');
            if (requestLine == null || requestLine.Length < 2)
            {
                return null;
            }

            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in lines.Skip(1))
            {
                var colon = line.IndexOf(':');
                if (colon <= 0) continue;
                headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
            }

            var bodyStart = headerEnd + 4;
            var contentLength = headers.TryGetValue("content-length", out var value) && int.TryParse(value, out var parsed) ? parsed : 0;
            if (contentLength < 0 || contentLength > 10 * 1024 * 1024)
            {
                throw new InvalidOperationException("HTTP request body is too large");
            }

            var body = new byte[contentLength];
            var already = Math.Min(contentLength, all.Length - bodyStart);
            if (already > 0)
            {
                Array.Copy(all, bodyStart, body, 0, already);
            }

            var offset = already;
            while (offset < contentLength)
            {
                var read = await stream.ReadAsync(body.AsMemory(offset, contentLength - offset), cancellationToken).ConfigureAwait(false);
                if (read == 0) break;
                offset += read;
            }

            return new HttpRequest(requestLine[0], requestLine[1], headers, body);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static int FindHeaderEnd(byte[] bytes)
    {
        for (var i = 0; i <= bytes.Length - 4; i++)
        {
            if (bytes[i] == '\r' && bytes[i + 1] == '\n' && bytes[i + 2] == '\r' && bytes[i + 3] == '\n')
            {
                return i;
            }
        }
        return -1;
    }

    private static async Task WriteResponseAsync(NetworkStream stream, int status, string reason, byte[] body, CancellationToken cancellationToken)
    {
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Type: application/json\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            "Connection: close\r\n" +
            "\r\n");
        await stream.WriteAsync(header.AsMemory(0, header.Length), cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(body.AsMemory(0, body.Length), cancellationToken).ConfigureAwait(false);
    }

    private static async Task WriteEmptyResponseAsync(NetworkStream stream, int status, string reason, CancellationToken cancellationToken)
    {
        var header = Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Length: 0\r\n" +
            "Connection: close\r\n" +
            "\r\n");
        await stream.WriteAsync(header.AsMemory(0, header.Length), cancellationToken).ConfigureAwait(false);
    }

    private sealed record HttpRequest(string Method, string Path, IReadOnlyDictionary<string, string> Headers, byte[] Body);
    private sealed record McpHttpResponse(int StatusCode, byte[] Body);
    private sealed record ResolvedRunSource(bool Ok, string? Source, string? Name, string? ErrorCode, string? ErrorMessage, string? Recovery)
    {
        internal static ResolvedRunSource Success(string source, string name) => new(true, source, name, null, null, null);
        internal static ResolvedRunSource Failure(string code, string message, string? recovery = null) => new(false, null, null, code, message, recovery);
    }

    private sealed class McpScriptRun : IDisposable
    {
        private readonly object _lock = new();
        private readonly List<McpConsoleLine> _console = new();
        private readonly List<McpConsoleLine> _errors = new();

        internal McpScriptRun(string id, string name)
        {
            Id = id;
            Name = name;
            Engine = new ScriptEngine();
        }

        internal string Id { get; }
        internal string Name { get; }
        internal ScriptEngine Engine { get; }
        internal string Status { get; set; } = "running";
        internal int RenderCount { get; private set; }
        internal bool HasError
        {
            get
            {
                lock (_lock)
                {
                    return _errors.Count > 0;
                }
            }
        }

        internal void RecordRender()
        {
            lock (_lock)
            {
                RenderCount++;
            }
        }

        internal void RecordConsole(string text)
        {
            lock (_lock)
            {
                _console.Add(McpConsoleLine.From("info", text));
            }
        }

        internal void RecordError(string text)
        {
            lock (_lock)
            {
                _errors.Add(McpConsoleLine.From("error", text));
                _console.Add(McpConsoleLine.From("error", text));
                Status = "failed";
            }
        }

        internal void Stop()
        {
            Engine.Stop();
            Status = "stopped";
        }

        internal JsonArray ConsoleJson()
        {
            lock (_lock)
            {
                return new JsonArray(_console.Select(line => line.ToJson()).ToArray<JsonNode?>());
            }
        }

        internal JsonNode? ErrorJson()
        {
            lock (_lock)
            {
                if (_errors.Count == 0) return null;
                return _errors[^1].ToJson();
            }
        }

        public void Dispose()
        {
            Engine.Dispose();
        }
    }

    private sealed record McpConsoleLine(string Level, string Text, string Timestamp)
    {
        internal static McpConsoleLine From(string level, string text) => new(level, text ?? string.Empty, DateTimeOffset.UtcNow.ToString("O"));

        internal JsonObject ToJson()
        {
            return new JsonObject
            {
                ["level"] = Level,
                ["text"] = Text,
                ["timestamp"] = Timestamp
            };
        }
    }
}
