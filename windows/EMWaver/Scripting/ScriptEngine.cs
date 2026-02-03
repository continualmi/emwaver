using Jint;
using Jint.Native;
using Jint.Native.Object;
using Jint.Runtime;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Diagnostics;

namespace EMWaver.Scripting;

public sealed class ScriptEngine : IDisposable
{
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _thread;
    private readonly Dictionary<string, JsValue> _callbacks = new(StringComparer.Ordinal);
    private readonly Dictionary<int, CancellationTokenSource> _timeouts = new();
    private int _nextTimeoutId = 1;

    private Engine? _engine;
    private string _bootstrapSource = string.Empty;

    private Action<ScriptTree>? _renderHandler;
    private Action<string>? _errorHandler;
    private Func<byte[], int, byte[]?>? _sendPacket;

    public ScriptEngine()
    {
        _thread = new Thread(ThreadMain)
        {
            IsBackground = true,
            Name = "EMWaver.ScriptEngine",
        };
        _thread.Start();
    }

    public void Setup(
        Action<ScriptTree> renderHandler,
        Func<byte[], int, byte[]?> sendPacket,
        Action<string>? errorHandler = null)
    {
        _renderHandler = renderHandler;
        _sendPacket = sendPacket;
        _errorHandler = errorHandler;

        Enqueue(() =>
        {
            EnsureBootstrapLoaded();
            EnsureEngineCreated();
        });
    }

    public void Execute(string script)
    {
        var trimmed = (script ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return;
        }

        Enqueue(() =>
        {
            if (ContainsAsyncTokens(trimmed))
            {
                EmitError("Script error: async/await is not supported. Scripts must be synchronous.");
                return;
            }

            EnsureBootstrapLoaded();
            EnsureEngineCreated();
            if (_engine == null)
            {
                EmitError("Script error: engine unavailable");
                return;
            }

            CancelAllTimeoutsLocked();
            _callbacks.Clear();

            try
            {
                // Re-inject host primitives before every run.
                InstallHostPrimitives(_engine);
                _engine.Execute(_bootstrapSource);

                var wrapped = "(() => {\n" + trimmed + "\n})();";
                _engine.Execute(wrapped);
            }
            catch (JavaScriptException ex)
            {
                EmitError("Script error: " + ex.Message);
            }
            catch (Exception ex)
            {
                EmitError("Script error: " + ex.Message);
            }
        });
    }

    public void Invoke(string token, IReadOnlyList<object?> arguments)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return;
        }

        Debug.WriteLine($"[EMWaver][Script][Invoke] token={token} argc={arguments?.Count ?? 0}");

        Enqueue(() =>
        {
            if (_engine == null)
            {
                EmitError("No engine available for callback");
                return;
            }
            if (!_callbacks.TryGetValue(token, out var fn))
            {
                EmitError("No callback registered for token " + token);
                return;
            }

            try
            {
                var jsArgs = arguments.Select(a => JsValue.FromObject(_engine, a)).ToArray();
                _engine.Invoke(fn, jsArgs);
            }
            catch (JavaScriptException ex)
            {
                EmitError("Script callback error: " + ex.Message);
            }
            catch (Exception ex)
            {
                EmitError("Script callback error: " + ex.Message);
            }
        });
    }

    public void Dispose()
    {
        _queue.CompleteAdding();
        try { _thread.Join(millisecondsTimeout: 600); } catch { }
    }

    private void ThreadMain()
    {
        foreach (var action in _queue.GetConsumingEnumerable())
        {
            try { action(); }
            catch (Exception ex) { EmitError("Script engine error: " + ex.Message); }
        }
    }

    private void Enqueue(Action action)
    {
        if (_queue.IsAddingCompleted)
        {
            return;
        }
        _queue.Add(action);
    }

    private void EnsureEngineCreated()
    {
        if (_engine != null)
        {
            return;
        }

        _engine = new Engine(options =>
        {
            options.Strict(false);
            // Guardrails: scripts can busy-loop; keep execution bounded.
            options.TimeoutInterval(TimeSpan.FromSeconds(30));
        });

        InstallHostPrimitives(_engine);
    }

    private void EnsureBootstrapLoaded()
    {
        if (!string.IsNullOrEmpty(_bootstrapSource))
        {
            return;
        }

        var baseDir = AppContext.BaseDirectory;
        var path = Path.Combine(baseDir, "Assets", "DefaultScripts", "script_bootstrap.emw");
        if (!File.Exists(path))
        {
            _bootstrapSource = string.Empty;
            EmitError("Script bootstrap missing from app bundle (Assets/DefaultScripts/script_bootstrap.emw)");
            return;
        }

        _bootstrapSource = File.ReadAllText(path);
    }

    private void InstallHostPrimitives(Engine engine)
    {
        engine.SetValue("_scriptRender", new Action<JsValue>(nodeValue =>
        {
            try
            {
                if (nodeValue.IsNull() || nodeValue.IsUndefined())
                {
                    EmitError("Script render called with invalid node");
                    return;
                }
                if (!nodeValue.IsObject())
                {
                    EmitError("Script render called with invalid node");
                    return;
                }

                var tree = BuildTreeFromJs(nodeValue.AsObject());
                if (tree == null)
                {
                    EmitError("Script render received malformed node");
                    return;
                }
                _renderHandler?.Invoke(tree);
            }
            catch (Exception ex)
            {
                EmitError("Script render error: " + ex.Message);
            }
        }));

        engine.SetValue("_scriptRegisterCallback", new Action<JsValue, JsValue>((tokenValue, fnValue) =>
        {
            if (!tokenValue.IsString())
            {
                return;
            }
            var token = tokenValue.AsString();
            if (string.IsNullOrWhiteSpace(token))
            {
                return;
            }

            // Store callable (function) as JsValue; we'll invoke via Engine.Invoke.
            _callbacks[token] = fnValue;
        }));

        engine.SetValue("_scriptSendPacket", new Func<JsValue, int, JsValue?>((bytesValue, timeoutMs) =>
        {
            var send = _sendPacket;
            if (send == null)
            {
                EmitError("Script sendPacket failed: host not ready");
                return JsValue.Null;
            }

            var payload = CoerceToByteArray(bytesValue);
            if (payload == null)
            {
                EmitError("Script sendPacket failed: invalid payload");
                return JsValue.Null;
            }

            var opcode = payload.Length > 0 ? $"0x{payload[0]:X2}" : "<empty>";
            Debug.WriteLine($"[EMWaver][Script][SendPacket] opcode={opcode} timeoutMs={timeoutMs}");

            var resp = send(payload, Math.Max(0, timeoutMs));
            if (resp == null)
            {
                EmitError($"Device command timed out (opcode {opcode}, timeout {timeoutMs}ms)");
                return JsValue.Null;
            }

            // Return a JS Array of numbers (sufficient for the bootstrap's slice/length/index access).
            var boxed = new int[resp.Length];
            for (var i = 0; i < resp.Length; i++) boxed[i] = resp[i];
            return JsValue.FromObject(engine, boxed);
        }));

        engine.SetValue("_scriptSleep", new Action<double>(ms =>
        {
            var durationMs = Math.Max(0.0, ms);
            if (durationMs <= 0) return;
            Thread.Sleep((int)Math.Min(int.MaxValue, durationMs));
        }));

        engine.SetValue("setTimeout", new Func<JsValue, double, int>((fnValue, ms) =>
        {
            // Defer type validation to invocation (keeps compatibility across Jint versions).
            var fn = fnValue;

            var delayMs = Math.Max(0.0, ms);
            var id = _nextTimeoutId++;

            var cts = new CancellationTokenSource();
            _timeouts[id] = cts;
            _ = ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    if (delayMs > 0)
                    {
                        cts.Token.WaitHandle.WaitOne(TimeSpan.FromMilliseconds(delayMs));
                    }
                    if (cts.IsCancellationRequested) return;

                    Enqueue(() =>
                    {
                        if (!_timeouts.Remove(id)) return;
                        try { _engine!.Invoke(fn, Array.Empty<JsValue>()); }
                        catch (JavaScriptException ex) { EmitError("Script timer error: " + ex.Message); }
                        catch (Exception ex) { EmitError("Script timer error: " + ex.Message); }
                    });
                }
                catch { }
            });
            return id;
        }));

        engine.SetValue("clearTimeout", new Action<int>(id =>
        {
            if (_timeouts.TryGetValue(id, out var cts))
            {
                cts.Cancel();
                _timeouts.Remove(id);
            }
        }));

        // Plot buffer store (UI.buffer)
        engine.SetValue("_scriptPlotBufferSet", new Func<JsValue, string>(bytesValue =>
        {
            var bytes = CoerceToByteArray(bytesValue);
            if (bytes == null) return string.Empty;
            var id = "buf:" + Guid.NewGuid().ToString("N");
            PlotBufferStore.Shared.SetBuffer(id, bytes);
            return id;
        }));

        // Minimal filesystem/path helpers used by built-in scripts.
        engine.SetValue("_scriptAppDataDir", new Func<string>(() =>
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EMWaver");
            return root;
        }));

        engine.SetValue("_scriptPathJoin", new Func<JsValue, string>(partsValue =>
        {
            var parts = new List<string>();
            if (partsValue.IsArray())
            {
                var arr = partsValue.AsArray();
                var len = (int)arr.Length;
                for (var i = 0; i < len; i++)
                {
                    var v = arr.Get(i);
                    if (v.IsNull() || v.IsUndefined()) continue;
                    var s = v.ToString();
                    if (!string.IsNullOrWhiteSpace(s)) parts.Add(s);
                }
            }
            if (parts.Count == 0) return string.Empty;
            var outPath = parts[0];
            for (var i = 1; i < parts.Count; i++) outPath = Path.Combine(outPath, parts[i]);
            return outPath;
        }));

        engine.SetValue("_scriptEnsureDir", new Action<string>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            Directory.CreateDirectory(p);
        }));

        engine.SetValue("_scriptReadDir", new Func<string, JsValue>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0 || !Directory.Exists(p))
            {
                return JsValue.FromObject(engine, Array.Empty<string>());
            }
            var entries = Directory.EnumerateFileSystemEntries(p).Select(Path.GetFileName).Where(n => !string.IsNullOrEmpty(n)).ToArray();
            return JsValue.FromObject(engine, entries);
        }));

        engine.SetValue("_scriptReadText", new Func<string, string>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0 || !File.Exists(p)) return string.Empty;
            return File.ReadAllText(p);
        }));

        engine.SetValue("_scriptWriteText", new Action<string, string>((path, content) =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            Directory.CreateDirectory(Path.GetDirectoryName(p) ?? p);
            File.WriteAllText(p, content ?? string.Empty);
        }));

        engine.SetValue("_scriptRemove", new Action<string>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            try
            {
                if (File.Exists(p)) File.Delete(p);
                else if (Directory.Exists(p)) Directory.Delete(p, recursive: true);
            }
            catch
            {
                // Ignore.
            }
        }));
    }

    private ScriptTree? BuildTreeFromJs(ObjectInstance node)
    {
        var root = BuildNode(node, path: new List<int>());
        if (root == null) return null;

        var meta = new Dictionary<string, object?>();
        var metadataVal = node.Get("metadata");
        if (metadataVal.IsObject())
        {
            if (TryToDictionary(metadataVal, out var dict))
            {
                meta = dict;
            }
        }

        return new ScriptTree { Root = root, Metadata = meta };
    }

    private ScriptNode? BuildNode(ObjectInstance node, List<int> path)
    {
        var typeVal = node.Get("type");
        var typeRaw = typeVal.IsString() ? typeVal.AsString() : null;
        if (!ScriptNodeTypeExtensions.TryFromRaw(typeRaw, out var nodeType))
        {
            return null;
        }

        var rawId = node.Get("id").IsString() ? node.Get("id").AsString() : string.Empty;
        var id = MakeStableIdentifier(rawId, nodeType, path);

        var rawProps = new Dictionary<string, object?>();
        var propsVal = node.Get("props");
        if (propsVal.IsObject() && TryToDictionary(propsVal, out var propsDict))
        {
            rawProps = propsDict;
        }

        var handlers = new Dictionary<ScriptEventType, string>();
        var handlersVal = node.Get("handlers");
        if (handlersVal.IsObject() && TryToDictionary(handlersVal, out var handlerDictObj))
        {
            foreach (var kv in handlerDictObj)
            {
                if (!ScriptEventTypeExtensions.TryFromRaw(kv.Key, out var eventType)) continue;
                if (kv.Value is string token && !string.IsNullOrWhiteSpace(token))
                {
                    handlers[eventType] = token;
                }
            }
        }

        var children = new List<ScriptNode>();
        var childrenVal = node.Get("children");
        if (childrenVal.IsArray())
        {
            var arr = childrenVal.AsArray();
            var len = (int)arr.Length;
            for (var i = 0; i < len; i++)
            {
                var childVal = arr.Get(i);
                if (!childVal.IsObject()) continue;
                var nextPath = new List<int>(path) { i };
                var built = BuildNode(childVal.AsObject(), nextPath);
                if (built != null) children.Add(built);
            }
        }

        return new ScriptNode
        {
            Id = id,
            Type = nodeType,
            Props = new ScriptNodeProps(rawProps, handlers),
            Children = children,
        };
    }

    private string MakeStableIdentifier(string rawId, ScriptNodeType nodeType, List<int> path)
    {
        if (!string.IsNullOrWhiteSpace(rawId) && !IsAutogeneratedId(rawId, nodeType))
        {
            return rawId;
        }
        var suffix = path.Count == 0 ? "root" : string.Join("-", path);
        return nodeType.ToRaw() + "-" + suffix;
    }

    private static bool IsAutogeneratedId(string id, ScriptNodeType nodeType)
    {
        var prefix = nodeType.ToRaw() + "_";
        if (!id.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var suffix = id.Substring(prefix.Length);
        return suffix.Length > 0 && suffix.All(char.IsDigit);
    }

    private static bool TryToDictionary(JsValue value, out Dictionary<string, object?> dict)
    {
        dict = new Dictionary<string, object?>(StringComparer.Ordinal);
        try
        {
            var obj = value.ToObject();
            if (obj is IDictionary<string, object?> typed)
            {
                foreach (var kv in typed) dict[kv.Key] = NormalizeObject(kv.Value);
                return true;
            }
            if (obj is IDictionary<string, object> untyped)
            {
                foreach (var kv in untyped) dict[kv.Key] = NormalizeObject(kv.Value);
                return true;
            }
            if (obj is IDictionary<string, string> str)
            {
                foreach (var kv in str) dict[kv.Key] = kv.Value;
                return true;
            }
            return false;
        }
        catch
        {
            dict = new Dictionary<string, object?>(StringComparer.Ordinal);
            return false;
        }
    }

    private static object? NormalizeObject(object? value)
    {
        if (value == null) return null;
        if (value is string || value is bool) return value;
        if (value is int || value is long || value is float || value is double || value is decimal) return value;
        if (value is IDictionary<string, object?> d1)
        {
            return d1.ToDictionary(kv => kv.Key, kv => NormalizeObject(kv.Value), StringComparer.Ordinal);
        }
        if (value is IDictionary<string, object> d2)
        {
            return d2.ToDictionary(kv => kv.Key, kv => NormalizeObject(kv.Value), StringComparer.Ordinal);
        }
        if (value is IEnumerable<object?> list)
        {
            return list.Select(NormalizeObject).ToList();
        }
        if (value is Array arr)
        {
            var outList = new List<object?>(arr.Length);
            foreach (var item in arr) outList.Add(NormalizeObject(item));
            return outList;
        }
        return value;
    }

    private static byte[]? CoerceToByteArray(JsValue value)
    {
        if (value.IsNull() || value.IsUndefined()) return null;
        if (!value.IsObject()) return null;

        // Accept JS Array-like objects (Array or typed array) by reading `length` and numeric indices.
        var obj = value.AsObject();
        var lengthVal = obj.Get("length");
        if (!lengthVal.IsNumber()) return null;
        var length = (int)Math.Max(0, lengthVal.AsNumber());
        var bytes = new byte[length];
        for (var i = 0; i < length; i++)
        {
            var v = obj.Get(i);
            if (!v.IsNumber()) return null;
            bytes[i] = (byte)((int)v.AsNumber() & 0xFF);
        }
        return bytes;
    }

    private void CancelAllTimeoutsLocked()
    {
        foreach (var kv in _timeouts.ToArray())
        {
            try { kv.Value.Cancel(); } catch { }
        }
        _timeouts.Clear();
    }

    private static bool ContainsAsyncTokens(string script)
    {
        // Keep behavior aligned across platforms: intentionally simple token scan.
        return script.Contains("await", StringComparison.Ordinal) || script.Contains("async", StringComparison.Ordinal);
    }

    private void EmitError(string message)
    {
        try { _errorHandler?.Invoke(message); }
        catch { }
    }
}
