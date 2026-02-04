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
        public bool UseMonacoEditor { get; set; } = true;
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
            var model = JsonSerializer.Deserialize<SettingsModel>(json);
            return model ?? new SettingsModel();
        }
        catch
        {
            // Fail safe: keep defaults (Monaco ON) if settings are unreadable.
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

    public bool UseMonacoEditor
    {
        get
        {
            lock (_lock)
            {
                return Load().UseMonacoEditor;
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.UseMonacoEditor = value;
                Save(m);
            }
            Changed?.Invoke();
        }
    }
}
