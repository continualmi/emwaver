using System;
using System.IO;
using System.Text.Json;

namespace EMWaver.Services;

internal enum AppThemeMode
{
    System,
    Light,
    Dark
}

internal sealed class AppSettings
{
    private static readonly object _lock = new();

    public event Action? Changed;

    private sealed class SettingsModel
    {
        // App appearance selection.
        public string AppTheme { get; set; } = "system";

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

    public AppThemeMode Theme
    {
        get
        {
            lock (_lock)
            {
                return ParseTheme(Load().AppTheme);
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.AppTheme = ToStorageValue(value);
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    private static AppThemeMode ParseTheme(string? value)
    {
        return (value ?? "").Trim().ToLowerInvariant() switch
        {
            "light" => AppThemeMode.Light,
            "dark" => AppThemeMode.Dark,
            _ => AppThemeMode.System,
        };
    }

    private static string ToStorageValue(AppThemeMode value)
    {
        return value switch
        {
            AppThemeMode.Light => "light",
            AppThemeMode.Dark => "dark",
            _ => "system",
        };
    }
}
