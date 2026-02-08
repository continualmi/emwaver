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
        // "simple" | "code"
        public string EditorMode { get; set; } = "code";

        // Back-compat for older builds. If present, we migrate to EditorMode.
        public bool? UseMonacoEditor { get; set; }

        // Backend selection
        public bool UseProductionBackend { get; set; } = true;
        public string LocalBackendUrl { get; set; } = "http://127.0.0.1:8787";
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
            var model = JsonSerializer.Deserialize<SettingsModel>(json) ?? new SettingsModel();

            // Migrate legacy bool toggle (if present) into EditorMode.
            if (model.UseMonacoEditor.HasValue)
            {
                model.EditorMode = model.UseMonacoEditor.Value ? "code" : "simple";
                model.UseMonacoEditor = null;
            }

            // Sanity.
            if (string.IsNullOrWhiteSpace(model.LocalBackendUrl))
            {
                model.LocalBackendUrl = "http://127.0.0.1:8787";
            }

            return model;
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

    public EMWaver.Services.EditorMode EditorMode
    {
        get
        {
            lock (_lock)
            {
                return Load().EditorMode switch
                {
                    "simple" => EMWaver.Services.EditorMode.Simple,
                    _ => EMWaver.Services.EditorMode.Code,
                };
            }
        }
        set
        {
            lock (_lock)
            {
                var m = Load();
                m.EditorMode = value switch
                {
                    EMWaver.Services.EditorMode.Simple => "simple",
                    _ => "code",
                };
                Save(m);
            }
            Changed?.Invoke();
        }
    }

    // Back-compat API used by older UI code paths.
    public bool UseMonacoEditor
    {
        get => EditorMode == EMWaver.Services.EditorMode.Code;
        set => EditorMode = value ? EMWaver.Services.EditorMode.Code : EMWaver.Services.EditorMode.Simple;
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
}
