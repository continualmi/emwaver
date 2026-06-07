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
using System.Text;
using System.Text.Json;
using EMWaver.Interop;

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
    private Dictionary<string, string> _moduleSources = new(StringComparer.OrdinalIgnoreCase);

    private Action<ScriptTree>? _renderHandler;
    private Action<string>? _errorHandler;
    private Action<string>? _consoleHandler;
    private Func<byte[], int, byte[]?>? _sendPacket;
    private Func<byte[]>? _getSamplerBytes;
    private Action? _clearSamplerBuffer;
    private Func<string?>? _getBoardType;
    private int _samplerPacketSizeBytes = NativeBufferRust.PacketSizeBytes;

    private bool _haltedUntilNextExecute;
    private string _currentScriptSource = string.Empty;
    private readonly object _samplerBufferLock = new();
    private byte[]? _samplerManualBuffer;

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
        Action<string>? errorHandler = null,
        Action<string>? consoleHandler = null,
        Func<byte[]>? getSamplerBytes = null,
        Action? clearSamplerBuffer = null,
        int? samplerPacketSizeBytes = null,
        Func<string?>? getBoardType = null)
    {
        _renderHandler = renderHandler;
        _sendPacket = sendPacket;
        _errorHandler = errorHandler;
        _consoleHandler = consoleHandler;
        _getSamplerBytes = getSamplerBytes;
        _clearSamplerBuffer = clearSamplerBuffer;
        _getBoardType = getBoardType;
        _samplerPacketSizeBytes = Math.Max(1, samplerPacketSizeBytes ?? NativeBufferRust.PacketSizeBytes);

        Enqueue(() =>
        {
            EnsureBootstrapLoaded();
            EnsureEngineCreated();
        });
    }

    public void Execute(string script, Action? initialExecutionCompleted = null)
    {
        var trimmed = (script ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            initialExecutionCompleted?.Invoke();
            return;
        }

        Enqueue(() =>
        {
            try
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

                _haltedUntilNextExecute = false;
                _currentScriptSource = trimmed;
                CancelAllTimeoutsLocked();
                _callbacks.Clear();

                try
                {
                    // Re-inject host primitives before every run.
                    InstallHostPrimitives(_engine);
                    _engine.Execute(_bootstrapSource);
                    SeedHostBoardType(_engine);

                    InstallRequire(_engine);
                    var transformed = ScriptSourceTranspiler.Transpile(trimmed);
                    var wrapped = "(() => {\n" + transformed + "\n})();";
                    _engine.Execute(wrapped);
                }
                catch (JavaScriptException ex)
                {
                    EmitError(FormatJavaScriptException("Script error", ex));
                }
                catch (Exception ex)
                {
                    EmitError(FormatGeneralException("Script error", ex));
                }
            }
            finally
            {
                try { initialExecutionCompleted?.Invoke(); } catch { }
            }
        });
    }

    public void Stop()
    {
        Enqueue(() =>
        {
            _haltedUntilNextExecute = true;
            CancelAllTimeoutsLocked();
            _callbacks.Clear();
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
            if (_haltedUntilNextExecute)
            {
                // Ignore callbacks/timers after a fatal script error until the next Execute().
                return;
            }
            if (!_callbacks.TryGetValue(token, out var fn))
            {
                EmitError("No callback registered for token " + token);
                return;
            }

            try
            {
                var safeArgs = arguments ?? Array.Empty<object?>();
                var jsArgs = safeArgs.Select(a => JsValue.FromObject(_engine, a)).ToArray();
                _engine.Invoke(fn, jsArgs);
            }
            catch (JavaScriptException ex)
            {
                EmitError(FormatJavaScriptException("Script callback error", ex));
            }
            catch (Exception ex)
            {
                EmitError(FormatGeneralException("Script callback error", ex));
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
        var path = Path.Combine(baseDir, "Assets", "DefaultScripts", "emw-kernel.emw");
        if (!File.Exists(path))
        {
            _bootstrapSource = string.Empty;
            EmitError("Script kernel missing from app bundle (Assets/DefaultScripts/emw-kernel.emw)");
            return;
        }

        _bootstrapSource = File.ReadAllText(path);
        _moduleSources = LoadModuleSources(Path.GetDirectoryName(path)!);
    }

    private static Dictionary<string, string> LoadModuleSources(string scriptsDir)
    {
        var modules = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(scriptsDir))
        {
            return modules;
        }

        foreach (var path in Directory.EnumerateFiles(scriptsDir, "*.emw", SearchOption.TopDirectoryOnly)
                     .Concat(Directory.EnumerateFiles(scriptsDir, "*.js", SearchOption.TopDirectoryOnly)))
        {
            var fileName = Path.GetFileName(path);
            var moduleName = Path.GetFileNameWithoutExtension(path);
            var transformed = ScriptSourceTranspiler.Transpile(File.ReadAllText(path));
            modules[fileName] = transformed;
            modules[moduleName] = transformed;
        }

        return modules;
    }

    private void InstallRequire(Engine engine)
    {
        var moduleSourcesJson = JsonSerializer.Serialize(_moduleSources);
        engine.SetValue("__emwModuleSourcesJson", moduleSourcesJson);
        engine.Execute("""
            var __emwModuleSources = JSON.parse(__emwModuleSourcesJson || "{}");
            var __emwModuleCache = {};
            function require(name) {
              var key = String(name || "");
              var resolved = Object.prototype.hasOwnProperty.call(__emwModuleSources, key)
                ? key
                : (Object.prototype.hasOwnProperty.call(__emwModuleSources, key + ".emw")
                  ? key + ".emw"
                  : (Object.prototype.hasOwnProperty.call(__emwModuleSources, key + ".js") ? key + ".js" : null));
              if (!resolved && key.slice(-4) === ".emw") {
                var withoutEmwExt = key.slice(0, -4);
                if (Object.prototype.hasOwnProperty.call(__emwModuleSources, withoutEmwExt)) resolved = withoutEmwExt;
              }
              if (!resolved && key.slice(-3) === ".js") {
                var withoutExt = key.slice(0, -3);
                if (Object.prototype.hasOwnProperty.call(__emwModuleSources, withoutExt)) resolved = withoutExt;
              }
              if (!resolved) throw new Error("Cannot find EMWaver module: " + key);
              if (Object.prototype.hasOwnProperty.call(__emwModuleCache, resolved)) return __emwModuleCache[resolved];
              var module = { exports: {} };
              __emwModuleCache[resolved] = module.exports;
              var fn = new Function("exports", "module", "require", __emwModuleSources[resolved]);
              fn(module.exports, module, require);
              __emwModuleCache[resolved] = module.exports;
              return module.exports;
            }
            """);
    }

    private void SeedHostBoardType(Engine engine)
    {
        var board = (_getBoardType?.Invoke() ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(board)) return;
        var safeBoard = board.Replace("\\", "\\\\").Replace("'", "\\'");
        try
        {
            engine.Execute($"try {{ __scriptGlobal.__scriptDeviceBoardType = '{safeBoard}'; }} catch (e) {{}} ");
        }
        catch
        {
            // Non-fatal; device.boardType() can still query firmware.
        }
    }

    private void InstallHostPrimitives(Engine engine)
    {
        engine.SetValue("_scriptRender", new Action<JsValue>(nodeValue =>
        {
            try
            {
                Debug.WriteLine("[EMWaver][Script][Render] called");

                if (nodeValue.IsNull() || nodeValue.IsUndefined())
                {
                    EmitError("Script render called with empty node payload (null/undefined).");
                    return;
                }

                ScriptTree? tree = null;
                string? parseError = null;

                if (nodeValue.IsString())
                {
                    var json = nodeValue.AsString();
                    if (!TryBuildTreeFromJson(json, out tree, out parseError))
                    {
                        EmitError("Script render JSON parse failed: " + (parseError ?? "unknown error"));
                        return;
                    }
                }
                else if (nodeValue.IsObject())
                {
                    tree = BuildTreeFromJs(nodeValue.AsObject(), out parseError);
                    if (tree == null)
                    {
                        EmitError("Script render node parse failed: " + (parseError ?? "unknown error"));
                        return;
                    }
                }
                else
                {
                    EmitError("Script render called with unsupported payload type: " + nodeValue.Type + ". Expected JSON string or object.");
                    return;
                }

                if (tree == null)
                {
                    EmitError("Script render produced no tree.");
                    return;
                }

                Debug.WriteLine($"[EMWaver][Script][Render] rootType={tree.Root.Type} rootId={tree.Root.Id}");
                _renderHandler?.Invoke(tree);
            }
            catch (Exception ex)
            {
                EmitError(FormatGeneralException("Script render error", ex));
            }
        }));

        engine.SetValue("_scriptConsolePrint", new Action<string>(line =>
        {
            try { _consoleHandler?.Invoke(line ?? string.Empty); } catch { }
        }));
        engine.Execute("""
            var console = (function() {
              function fmt(args) {
                var out = [];
                for (var i = 0; i < args.length; i += 1) {
                  var value = args[i];
                  if (value === null) out.push('null');
                  else if (value === undefined) out.push('undefined');
                  else if (typeof value === 'object') {
                    try { out.push(JSON.stringify(value)); } catch (e) { out.push(String(value)); }
                  } else out.push(String(value));
                }
                return out.join(' ');
              }
              return {
                log: function() { _scriptConsolePrint(fmt(arguments)); },
                warn: function() { _scriptConsolePrint('[warn] ' + fmt(arguments)); },
                error: function() { _scriptConsolePrint('[error] ' + fmt(arguments)); }
              };
            })();
            """);

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
                        if (_haltedUntilNextExecute) return;
                        try { _engine!.Invoke(fn, Array.Empty<JsValue>()); }
                        catch (JavaScriptException ex) { EmitError(FormatJavaScriptException("Script timer error", ex)); }
                        catch (Exception ex) { EmitError(FormatGeneralException("Script timer error", ex)); }
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

        // Keep parity with macOS: expose the live sampler capture stream as a built-in
        // plot source named "samplerBits" so sampler.emw can render UI.plot directly.
        PlotBufferStore.Shared.SetProvider("samplerBits", () => GetSamplerBytes());

        // Sampler buffer API parity with macOS (used by emw-kernel.emw + sampler.emw).
        engine.SetValue("_scriptSamplerBufferGetPacketCount", new Func<int>(() =>
        {
            var len = GetSamplerBytes().Length;
            return len <= 0 ? 0 : (len + _samplerPacketSizeBytes - 1) / _samplerPacketSizeBytes;
        }));

        engine.SetValue("_scriptSamplerBufferGetLenBytes", new Func<int>(() => GetSamplerBytes().Length));

        engine.SetValue("_scriptSamplerBufferGetBytes", new Func<JsValue>(() =>
        {
            var bytes = GetSamplerBytes();
            return JsValue.FromObject(engine, bytes.Select(static b => (int)b).ToArray());
        }));

        engine.SetValue("_scriptSamplerBufferClear", new Action(() =>
        {
            lock (_samplerBufferLock) _samplerManualBuffer = Array.Empty<byte>();
            (_clearSamplerBuffer ?? NativeBufferRust.ClearAll)();
        }));

        engine.SetValue("_scriptSamplerBufferReadPacketsSince", new Func<int, int, JsValue>((packetIndex, maxPackets) =>
        {
            var data = GetSamplerBytes();
            var totalPackets = data.Length <= 0 ? 0 : (data.Length + _samplerPacketSizeBytes - 1) / _samplerPacketSizeBytes;
            var startPacket = Math.Max(0, packetIndex);
            var availablePackets = Math.Max(0, totalPackets - startPacket);
            var toRead = Math.Max(0, Math.Min(availablePackets, Math.Max(1, maxPackets)));

            var startByte = startPacket * _samplerPacketSizeBytes;
            var endByte = Math.Min(data.Length, startByte + toRead * _samplerPacketSizeBytes);
            var slice = startByte < endByte ? data[startByte..endByte] : Array.Empty<byte>();

            var payload = new Dictionary<string, object?>
            {
                ["data"] = slice.Select(static b => (int)b).ToArray(),
                ["nextPacketIndex"] = startPacket + toRead,
                ["availablePackets"] = availablePackets,
            };
            return JsValue.FromObject(engine, payload);
        }));

        engine.SetValue("_scriptBufferSetBytes", new Func<JsValue, int>(bytesValue =>
        {
            var bytes = CoerceToByteArray(bytesValue) ?? Array.Empty<byte>();
            lock (_samplerBufferLock) _samplerManualBuffer = (byte[])bytes.Clone();
            return bytes.Length;
        }));

        engine.SetValue("_scriptBufferSaveBytesFile", new Action<string>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            Directory.CreateDirectory(Path.GetDirectoryName(p) ?? p);
            File.WriteAllBytes(p, GetSamplerBytes());
        }));

        engine.SetValue("_scriptBufferBuildSignedRawTimings", new Func<int, string>(samplePeriodUs =>
        {
            var tickUs = Math.Clamp(samplePeriodUs <= 0 ? 10 : samplePeriodUs, 1, 255);
            return BuildSignedRawTimingsText(GetSamplerBytes(), tickUs);
        }));

        // Minimal filesystem/path helpers used by built-in scripts.
        engine.SetValue("_scriptAppDataDir", new Func<string>(() =>
        {
            var scriptsDir = GetScriptsDataDir();
            MigrateLegacySignalsToScriptsDir(scriptsDir);
            Directory.CreateDirectory(scriptsDir);
            return scriptsDir;
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

        var readText = new Func<string, string>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0 || !File.Exists(p)) return string.Empty;
            return File.ReadAllText(p);
        });
        engine.SetValue("_scriptReadText", readText);
        engine.SetValue("_scriptReadFileText", readText);

        var writeText = new Action<string, string>((path, content) =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            Directory.CreateDirectory(Path.GetDirectoryName(p) ?? p);
            File.WriteAllText(p, content ?? string.Empty);
        });
        engine.SetValue("_scriptWriteText", writeText);
        engine.SetValue("_scriptWriteFileText", writeText);

        var readBytes = new Func<string, JsValue>(path =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0 || !File.Exists(p))
            {
                return JsValue.FromObject(engine, Array.Empty<int>());
            }
            var bytes = File.ReadAllBytes(p);
            return JsValue.FromObject(engine, bytes.Select(static b => (int)b).ToArray());
        });
        engine.SetValue("_scriptReadFileBytes", readBytes);

        var writeBytes = new Action<string, JsValue>((path, bytesValue) =>
        {
            var p = (path ?? string.Empty).Trim();
            if (p.Length == 0) return;
            var bytes = CoerceToByteArray(bytesValue) ?? Array.Empty<byte>();
            Directory.CreateDirectory(Path.GetDirectoryName(p) ?? p);
            File.WriteAllBytes(p, bytes);
        });
        engine.SetValue("_scriptWriteFileBytes", writeBytes);

        var removePath = new Action<string>(path =>
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
        });
        engine.SetValue("_scriptRemove", removePath);
        engine.SetValue("_scriptRemovePath", removePath);
    }

    private byte[] GetSamplerBytes()
    {
        lock (_samplerBufferLock)
        {
            if (_samplerManualBuffer != null)
            {
                return (byte[])_samplerManualBuffer.Clone();
            }
        }
        return (_getSamplerBytes ?? NativeBufferRust.GetRxSnapshot)();
    }

    private static string GetScriptsDataDir()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver",
            "Scripts"
        );
    }

    private static void MigrateLegacySignalsToScriptsDir(string scriptsDir)
    {
        try
        {
            var legacySignalsDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EMWaver",
                "Signals"
            );
            if (!Directory.Exists(legacySignalsDir)) return;

            Directory.CreateDirectory(scriptsDir);

            foreach (var src in Directory.EnumerateFiles(legacySignalsDir, "*", SearchOption.TopDirectoryOnly))
            {
                var ext = Path.GetExtension(src);
                if (!string.Equals(ext, ".raw", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(ext, ".txt", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var dst = Path.Combine(scriptsDir, Path.GetFileName(src));
                if (File.Exists(dst)) continue;
                File.Copy(src, dst, overwrite: false);
            }
        }
        catch
        {
            // Best-effort migration only.
        }
    }

    private static string BuildSignedRawTimingsText(byte[] bytes, int tickUs)
    {
        if (bytes.Length == 0) return string.Empty;

        var sb = new StringBuilder();
        var totalBits = bytes.Length * 8;
        var prevBit = (bytes[0] & 1) != 0;
        var run = 1;

        for (var bit = 1; bit < totalBits; bit++)
        {
            var by = bit >> 3;
            var bi = bit & 7;
            var curBit = ((bytes[by] >> bi) & 1) == 1;
            if (curBit == prevBit)
            {
                run++;
                continue;
            }

            AppendRun(sb, prevBit, run, tickUs);
            prevBit = curBit;
            run = 1;
        }

        AppendRun(sb, prevBit, run, tickUs);
        return sb.ToString();

        static void AppendRun(StringBuilder sb, bool high, int runBits, int tick)
        {
            if (runBits <= 0) return;
            var us = runBits * tick;
            if (!high) us = -us;
            if (sb.Length > 0) sb.Append('\n');
            sb.Append(us);
        }
    }

    private ScriptTree? BuildTreeFromJs(ObjectInstance node, out string? error)
    {
        error = null;

        Dictionary<string, object?> rootDict;
        try
        {
            if (_engine == null)
            {
                error = "engine unavailable";
                return null;
            }

            if (!TryToDictionary(JsValue.FromObject(_engine, node), out rootDict))
            {
                error = "root node is not a valid object";
                return null;
            }
        }
        catch (Exception ex)
        {
            error = "failed to convert JS tree: " + ex.Message;
            return null;
        }

        return BuildTreeFromDictionary(rootDict, out error);
    }

    private bool TryBuildTreeFromJson(string json, out ScriptTree? tree, out string? error)
    {
        tree = null;
        error = null;

        if (string.IsNullOrWhiteSpace(json))
        {
            error = "empty JSON payload";
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                error = "root JSON value is " + doc.RootElement.ValueKind + ", expected object";
                return false;
            }

            var rootDict = JsonElementToObject(doc.RootElement) as Dictionary<string, object?>;
            if (rootDict == null)
            {
                error = "root JSON object conversion failed";
                return false;
            }

            tree = BuildTreeFromDictionary(rootDict, out error);
            return tree != null;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private ScriptTree? BuildTreeFromDictionary(Dictionary<string, object?> root, out string? error)
    {
        error = null;

        var rootNode = BuildNodeFromDictionary(root, new List<int>(), out error);
        if (rootNode == null)
        {
            return null;
        }

        var metadata = new Dictionary<string, object?>();
        if (root.TryGetValue("metadata", out var metadataObj) && metadataObj is Dictionary<string, object?> metaDict)
        {
            metadata = metaDict;
        }

        return new ScriptTree { Root = rootNode, Metadata = metadata };
    }

    private ScriptNode? BuildNodeFromDictionary(Dictionary<string, object?> node, List<int> path, out string? error)
    {
        error = null;

        var typeRaw = node.TryGetValue("type", out var typeObj) ? typeObj?.ToString() : null;
        if (!ScriptNodeTypeExtensions.TryFromRaw(typeRaw, out var nodeType))
        {
            error = "unknown or missing node type '" + (typeRaw ?? "<null>") + "' at path " + FormatPath(path) + ".";
            return null;
        }

        var rawId = node.TryGetValue("id", out var idObj) ? idObj?.ToString() ?? string.Empty : string.Empty;
        var id = MakeStableIdentifier(rawId, nodeType, path);

        var rawProps = new Dictionary<string, object?>();
        if (node.TryGetValue("props", out var propsObj) && propsObj is Dictionary<string, object?> propsDict)
        {
            rawProps = propsDict;
        }

        var handlers = new Dictionary<ScriptEventType, string>();
        if (node.TryGetValue("handlers", out var handlersObj) && handlersObj is Dictionary<string, object?> handlerDictObj)
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
        if (node.TryGetValue("children", out var childrenObj) && childrenObj is List<object?> childList)
        {
            for (var i = 0; i < childList.Count; i++)
            {
                if (childList[i] is not Dictionary<string, object?> childDict)
                {
                    continue;
                }

                var nextPath = new List<int>(path) { i };
                var built = BuildNodeFromDictionary(childDict, nextPath, out error);
                if (built == null)
                {
                    return null;
                }
                children.Add(built);
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

    private static object? JsonElementToObject(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                {
                    var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
                    foreach (var prop in element.EnumerateObject())
                    {
                        dict[prop.Name] = JsonElementToObject(prop.Value);
                    }
                    return dict;
                }
            case JsonValueKind.Array:
                {
                    var list = new List<object?>();
                    foreach (var item in element.EnumerateArray())
                    {
                        list.Add(JsonElementToObject(item));
                    }
                    return list;
                }
            case JsonValueKind.String:
                return element.GetString();
            case JsonValueKind.Number:
                if (element.TryGetInt64(out var l)) return l;
                if (element.TryGetDouble(out var d)) return d;
                return element.GetRawText();
            case JsonValueKind.True:
                return true;
            case JsonValueKind.False:
                return false;
            case JsonValueKind.Null:
            case JsonValueKind.Undefined:
                return null;
            default:
                return element.GetRawText();
        }
    }

    private static string FormatPath(List<int> path)
    {
        return path.Count == 0 ? "root" : "root.children[" + string.Join("].children[", path) + "]";
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

    private string FormatJavaScriptException(string prefix, JavaScriptException ex)
    {
        var sb = new StringBuilder();
        sb.Append(prefix).Append(": ").Append(ex.Message);

        var line = ex.Location.Start.Line;
        var column = ex.Location.Start.Column;

        // User code is wrapped in `(() => { ... })();` for isolation.
        // Adjust line numbers back to the user's source where possible.
        var userLine = line > 0 ? Math.Max(1, line - 1) : 0;
        if (userLine > 0)
        {
            sb.AppendLine();
            sb.Append("Location: line ").Append(userLine).Append(", column ").Append(Math.Max(1, column));
        }

        var frame = BuildSourceFrame(_currentScriptSource, userLine, contextLines: 2);
        if (!string.IsNullOrWhiteSpace(frame))
        {
            sb.AppendLine();
            sb.AppendLine();
            sb.AppendLine("Code:");
            sb.Append(frame);
        }

        var details = ex.ToString();
        if (!string.IsNullOrWhiteSpace(details))
        {
            sb.AppendLine();
            sb.AppendLine();
            sb.AppendLine("Details:");
            sb.Append(details);
        }

        return sb.ToString();
    }

    private static string FormatGeneralException(string prefix, Exception ex)
    {
        if (string.IsNullOrWhiteSpace(ex.StackTrace))
        {
            return prefix + ": " + ex.Message;
        }
        return prefix + ": " + ex.Message + "\n\nDetails:\n" + ex;
    }

    private static string BuildSourceFrame(string source, int lineNumber, int contextLines)
    {
        if (string.IsNullOrWhiteSpace(source) || lineNumber <= 0)
        {
            return string.Empty;
        }

        var normalized = source.Replace("\r\n", "\n").Replace('\r', '\n');
        var lines = normalized.Split('\n');
        if (lineNumber > lines.Length)
        {
            return string.Empty;
        }

        var start = Math.Max(1, lineNumber - contextLines);
        var end = Math.Min(lines.Length, lineNumber + contextLines);
        var sb = new StringBuilder();
        for (var i = start; i <= end; i++)
        {
            var marker = i == lineNumber ? ">" : " ";
            sb.Append(marker)
              .Append(i.ToString().PadLeft(4))
              .Append(" | ")
              .AppendLine(lines[i - 1]);
        }
        return sb.ToString().TrimEnd();
    }

    private void EmitError(string message)
    {
        // Treat any script error as fatal for the current run.
        // This prevents runaway timers (e.g. every()) from repeatedly throwing and
        // spamming UI dialogs when the device is disconnected.
        _haltedUntilNextExecute = true;
        CancelAllTimeoutsLocked();
        _callbacks.Clear();

        try { _errorHandler?.Invoke(message); }
        catch { }
    }
}
