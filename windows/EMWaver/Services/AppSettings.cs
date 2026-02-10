using System;
using System.IO;
using System.Text.Json;

namespace EMWaver.Services;

internal sealed class AppSettings
{
    private static readonly object _lock = new();

    public event Action? Changed;

    private sealed class SettingsModel
    {
        // Backend selection
        public bool UseProductionBackend { get; set; } = true;
        public string LocalBackendUrl { get; set; } = "http://127.0.0.1:8787";

        // Frontend selection (used by web-first sign-in and purchase flows).
        public bool UseProductionFrontend { get; set; } = true;
        public string LocalFrontendUrl { get; set; } = "http://localhost:3000";
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

            // Migration: Windows used to have editor-mode settings ("Code (JS)" vs "Simple").
            // We no longer support variants on Windows; ignore and scrub those keys when present.
            var needsScrub = json.Contains("\"EditorMode\"", StringComparison.OrdinalIgnoreCase)
                || json.Contains("\"UseMonacoEditor\"", StringComparison.OrdinalIgnoreCase);

            var model = JsonSerializer.Deserialize<SettingsModel>(json) ?? new SettingsModel();

            var needsSave = needsScrub;

            // Sanity.
            if (string.IsNullOrWhiteSpace(model.LocalBackendUrl))
            {
                model.LocalBackendUrl = "http://127.0.0.1:8787";
                needsSave = true;
            }

            var normalizedFrontendUrl = NormalizeLocalFrontendUrl(model.LocalFrontendUrl);
            if (!string.Equals(normalizedFrontendUrl, model.LocalFrontendUrl, StringComparison.Ordinal))
            {
                model.LocalFrontendUrl = normalizedFrontendUrl;
                needsSave = true;
            }

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

    private static string NormalizeLocalFrontendUrl(string? value)
    {
        var trimmed = (value ?? "").Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return "http://localhost:3000";
        }

        // Migration: older builds defaulted to 127.0.0.1, but some environments only
        // work reliably with localhost for web sign-in handoff.
        return trimmed
            .Replace("http://127.0.0.1:3000", "http://localhost:3000", StringComparison.OrdinalIgnoreCase)
            .Replace("https://127.0.0.1:3000", "https://localhost:3000", StringComparison.OrdinalIgnoreCase);
    }

    public bool UseProductionBackend
    {
        get
        {
            lock (_lock)
            {
                return Load().UseProductionBackend;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.UseProductionBackend = value;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public string LocalBackendUrl
    {
        get
        {
            lock (_lock)
            {
                return Load().LocalBackendUrl ?? "";
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.LocalBackendUrl = value ?? "";
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public bool UseProductionFrontend
    {
        get
        {
            lock (_lock)
            {
                return Load().UseProductionFrontend;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.UseProductionFrontend = value;
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    public string LocalFrontendUrl
    {
        get
        {
            lock (_lock)
            {
                return Load().LocalFrontendUrl ?? "";
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.LocalFrontendUrl = NormalizeLocalFrontendUrl(value);
                Save(m);
            }
            Changed?.Invoke();
        }
    }
}
