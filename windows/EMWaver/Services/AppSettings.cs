using System;
using System.IO;
using System.Text.Json;

namespace EMWaver.Services;

public sealed class AppSettings
{
    private static readonly object _lock = new();

    public event Action? Changed;

    private sealed class SettingsModel
    {
        public bool ShowTransportLog { get; set; } = false;
        public bool TransportDebugLoggingEnabled { get; set; } = true;
        public string? LastOpenScript { get; set; }
        public bool McpServerEnabled { get; set; } = false;
        public int McpServerPort { get; set; } = 3923;
        public string? McpServerToken { get; set; }
    }

    private static string GetSettingsPath()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EMWaver");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "settings.json");
    }

    private static SettingsModel Load()
    {
        try
        {
            var path = GetSettingsPath();
            if (!File.Exists(path))
            {
                return new SettingsModel();
            }

            var json = File.ReadAllText(path);

            // Migration: Windows used to have editor-mode settings ("Code (JS)" vs "Simple")
            // and app theme settings. We no longer support those variants on Windows;
            // ignore and scrub those keys when present.
            var needsScrub = json.Contains("\"EditorMode\"", StringComparison.OrdinalIgnoreCase)
                || json.Contains("\"UseMonacoEditor\"", StringComparison.OrdinalIgnoreCase)
                || json.Contains("\"AppTheme\"", StringComparison.OrdinalIgnoreCase);

            var model = JsonSerializer.Deserialize<SettingsModel>(json) ?? new SettingsModel();

            var needsSave = needsScrub;

            if (needsSave)
            {
                // Best-effort: rewrite migrated/sanitized settings.
                try { Save(model); } catch { }
            }

            return model;
        }
        catch
        {
            // Fail safe: keep defaults.
            return new SettingsModel();
        }
    }

    private static void Save(SettingsModel model)
    {
        var path = GetSettingsPath();
        var tmp = path + ".tmp";
        var json = JsonSerializer.Serialize(model, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(tmp, json);

        // Atomic-ish replace.
        try
        {
            File.Copy(tmp, path, overwrite: true);
            File.Delete(tmp);
        }
        catch
        {
            // Best effort.
            try { File.Move(tmp, path, overwrite: true); } catch { }
        }
    }

    public bool ShowTransportLog
    {
        get
        {
            lock (_lock)
            {
                return Load().ShowTransportLog;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.ShowTransportLog = value;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public bool TransportDebugLoggingEnabled
    {
        get => true;
        set
        {
            // ESP firmware packet diagnostics are always enabled for developer
            // console traces; the user-facing setting was removed from Settings.
        }
    }

    public string? LastOpenScript
    {
        get
        {
            lock (_lock)
            {
                return Load().LastOpenScript;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                var next = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
                if (string.Equals(m.LastOpenScript, next, StringComparison.OrdinalIgnoreCase)) return;
                m.LastOpenScript = next;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public bool McpServerEnabled
    {
        get
        {
            lock (_lock)
            {
                return Load().McpServerEnabled;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                if (m.McpServerEnabled == value) return;
                m.McpServerEnabled = value;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public int McpServerPort
    {
        get
        {
            lock (_lock)
            {
                var port = Load().McpServerPort;
                return IsValidMcpPort(port) ? port : 3923;
            }
        }
        set
        {
            lock (_lock)
            {
                var next = IsValidMcpPort(value) ? value : 3923;
                var m = Load();
                if (m.McpServerPort == next) return;
                m.McpServerPort = next;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public string McpServerToken
    {
        get
        {
            lock (_lock)
            {
                var m = Load();
                if (!string.IsNullOrWhiteSpace(m.McpServerToken))
                {
                    return m.McpServerToken.Trim();
                }

                m.McpServerToken = GenerateMcpToken();
                Save(m);
                return m.McpServerToken;
            }
        }
    }

    public string ResetMcpServerToken()
    {
        lock (_lock)
        {
            var m = Load();
            m.McpServerToken = GenerateMcpToken();
            Save(m);
            Changed?.Invoke();
            return m.McpServerToken;
        }
    }

    private static bool IsValidMcpPort(int port) => port is >= 1024 and <= 65535;

    private static string GenerateMcpToken()
    {
        return Convert.ToHexString(Guid.NewGuid().ToByteArray()) + Convert.ToHexString(Guid.NewGuid().ToByteArray());
    }
}
