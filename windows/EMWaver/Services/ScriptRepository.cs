using EMWaver.Models;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace EMWaver.Services;

public sealed class ScriptRepository
{
    private const string ScriptExtension = ".emw";
    private static readonly string[] ScriptExtensions = [ScriptExtension, ".js"];

    public ObservableCollection<ScriptInfo> All { get; } = new();

    internal string LocalScriptsDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "EMWaver",
        "Scripts"
    );

    internal string BundledScriptsDir { get; } = ResolveBundledScriptsDir();

    private static string ResolveBundledScriptsDir()
    {
        // Unpackaged/dev runs: scripts are copied under Assets\DefaultScripts next to the exe.
        var baseDir = Path.Combine(AppContext.BaseDirectory, "Assets", "DefaultScripts");
        if (Directory.Exists(baseDir))
        {
            return baseDir;
        }

        // WPF runs unpackaged for the current Windows migration path. Avoid Package.Current
        // probes here because they raise noisy first-chance FileNotFoundException events.
        return baseDir;
    }

    internal async Task EnsureBootstrappedAsync()
    {
        Directory.CreateDirectory(LocalScriptsDir);

        // Bundled/example scripts are read-only and live in BundledScriptsDir.
        // Users can copy them into LocalScriptsDir to edit.
        await Task.CompletedTask;
        RefreshAll();
    }

    internal Task<IReadOnlyList<ScriptInfo>> ListScriptsAsync()
    {
        Directory.CreateDirectory(LocalScriptsDir);

        var localRaw = Directory
            .EnumerateFiles(LocalScriptsDir, "*.*", SearchOption.TopDirectoryOnly)
            .Where(p => ScriptExtensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
            .ToList();

        var bundledRaw = new List<string>();
        if (Directory.Exists(BundledScriptsDir))
        {
            bundledRaw = Directory
                .EnumerateFiles(BundledScriptsDir, "*.*", SearchOption.TopDirectoryOnly)
                .Where(p => ScriptExtensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
                .ToList();
        }

        var bundledNames = new HashSet<string>(
            bundledRaw.Select(p => Path.GetFileNameWithoutExtension(p)),
            StringComparer.OrdinalIgnoreCase
        );

        var bundledByName = bundledRaw
            .GroupBy(p => Path.GetFileNameWithoutExtension(p), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        // If a local script is an exact byte-for-byte copy of a bundled script with the same name,
        // treat it as redundant and prefer showing the bundled script (avoids confusing duplicates
        // created by old/buggy bootstrapping behavior).
        var local = localRaw
            .Select(p =>
            {
                var name = Path.GetFileNameWithoutExtension(p);
                return new ScriptInfo(name, p, IsBundled: false, ShadowsBundled: bundledNames.Contains(name));
            })
            .ToList();

        var redundantLocalFullPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in local)
        {
            if (!s.ShadowsBundled)
            {
                continue;
            }

            if (!bundledByName.TryGetValue(s.Name, out var bundledPath))
            {
                continue;
            }

            try
            {
                var localBytes = File.ReadAllBytes(s.FullPath);
                var bundledBytes = File.ReadAllBytes(bundledPath);
                if (localBytes.SequenceEqual(bundledBytes))
                {
                    redundantLocalFullPaths.Add(s.FullPath);
                }
            }
            catch
            {
                // If we can't read/compare, keep the local script visible.
            }
        }

        if (redundantLocalFullPaths.Count > 0)
        {
            local = local
                .Where(s => !redundantLocalFullPaths.Contains(s.FullPath))
                .ToList();
        }

        // Always show bundled scripts (examples) even if a local script with the same name exists.
        // Local scripts can be treated as “overrides”, but we still want the examples to remain visible.
        var bundledVisible = bundledRaw
            .Select(p => new ScriptInfo(Path.GetFileNameWithoutExtension(p), p, IsBundled: true, ShadowsBundled: false))
            .ToList();

        // Match the Apple script list ordering: bundled examples first, then libraries,
        // then kernel/runtime files, then local custom/override scripts.
        var scripts = bundledVisible
            .Concat(local)
            .OrderBy(s => s.KindSortRank)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult<IReadOnlyList<ScriptInfo>>(scripts);
    }

    internal async Task<string> ReadScriptTextAsync(ScriptInfo script)
    {
        return await File.ReadAllTextAsync(script.FullPath);
    }

    internal async Task SaveScriptTextAsync(ScriptInfo script, string content)
    {
        if (script.IsBundled)
        {
            throw new InvalidOperationException("Bundled scripts are read-only");
        }

        Directory.CreateDirectory(LocalScriptsDir);
        await File.WriteAllTextAsync(script.FullPath, content);
    }

    internal async Task<ScriptInfo> CreateLocalScriptAsync(string name, string content)
    {
        Directory.CreateDirectory(LocalScriptsDir);

        var safe = SanitizeFileName(name);
        if (!ScriptExtensions.Contains(Path.GetExtension(safe), StringComparer.OrdinalIgnoreCase))
        {
            safe += ScriptExtension;
        }

        var fullPath = Path.Combine(LocalScriptsDir, safe);
        if (File.Exists(fullPath))
        {
            throw new IOException("A script with that name already exists");
        }

        await File.WriteAllTextAsync(fullPath, content ?? string.Empty);
        return new ScriptInfo(Path.GetFileNameWithoutExtension(fullPath), fullPath, IsBundled: false, ShadowsBundled: false);
    }

    internal async Task<ScriptInfo> CopyToLocalAsync(ScriptInfo source, string newName)
    {
        var content = await ReadScriptTextAsync(source);
        return await CreateLocalScriptAsync(newName, content);
    }

    internal Task DeleteLocalScriptAsync(ScriptInfo script)
    {
        if (script.IsBundled)
        {
            throw new InvalidOperationException("Bundled scripts cannot be deleted");
        }

        if (File.Exists(script.FullPath))
        {
            File.Delete(script.FullPath);
        }

        return Task.CompletedTask;
    }

    internal Task<ScriptInfo> RenameLocalScriptAsync(ScriptInfo script, string newName)
    {
        if (script.IsBundled)
        {
            throw new InvalidOperationException("Bundled scripts cannot be renamed");
        }

        Directory.CreateDirectory(LocalScriptsDir);

        var safe = SanitizeFileName(newName);
        if (!ScriptExtensions.Contains(Path.GetExtension(safe), StringComparer.OrdinalIgnoreCase))
        {
            safe += ScriptExtension;
        }

        var dest = Path.Combine(LocalScriptsDir, safe);
        if (File.Exists(dest))
        {
            throw new IOException("A script with that name already exists");
        }

        File.Move(script.FullPath, dest);
        return Task.FromResult(new ScriptInfo(Path.GetFileNameWithoutExtension(dest), dest, IsBundled: false, ShadowsBundled: false));
    }

    public void RefreshAll()
    {
        var scripts = ListScriptsAsync().GetAwaiter().GetResult();
        All.Clear();
        foreach (var script in scripts)
        {
            All.Add(script);
        }
    }

    public ScriptInfo Create(string name, string content)
    {
        var script = CreateLocalScriptAsync(name, content).GetAwaiter().GetResult();
        RefreshAll();
        return script;
    }

    public void Save(string fileName, string content)
    {
        var script = All.FirstOrDefault(s => string.Equals(s.FileName, fileName, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException("Script not found", fileName);
        SaveScriptTextAsync(script, content).GetAwaiter().GetResult();
        RefreshAll();
    }

    public ScriptInfo Rename(string fileName, string newName)
    {
        var script = All.FirstOrDefault(s => string.Equals(s.FileName, fileName, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException("Script not found", fileName);
        var renamed = RenameLocalScriptAsync(script, newName).GetAwaiter().GetResult();
        RefreshAll();
        return renamed;
    }

    public void Delete(string fileName)
    {
        var script = All.FirstOrDefault(s => string.Equals(s.FileName, fileName, StringComparison.OrdinalIgnoreCase))
            ?? throw new FileNotFoundException("Script not found", fileName);
        DeleteLocalScriptAsync(script).GetAwaiter().GetResult();
        RefreshAll();
    }

    private static string SanitizeFileName(string name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            throw new ArgumentException("Name cannot be empty", nameof(name));
        }

        foreach (var c in Path.GetInvalidFileNameChars())
        {
            trimmed = trimmed.Replace(c, '_');
        }

        return trimmed;
    }

}
