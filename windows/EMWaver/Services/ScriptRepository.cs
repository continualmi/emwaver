using EMWaver.Models;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class ScriptRepository
{
    private static readonly string[] EmwExtensions = [".emw"];

    internal string LocalScriptsDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "EMWaver",
        "Scripts"
    );

    internal string BundledScriptsDir { get; } = Path.Combine(
        AppContext.BaseDirectory,
        "Assets",
        "DefaultScripts"
    );

    internal async Task EnsureBootstrappedAsync()
    {
        Directory.CreateDirectory(LocalScriptsDir);

        // Note: we intentionally do NOT copy bundled scripts into LocalScriptsDir.
        // Parity with macOS: bundled/example scripts are read-only and can be copied.
        await Task.CompletedTask;
    }

    internal Task<IReadOnlyList<ScriptInfo>> ListScriptsAsync()
    {
        Directory.CreateDirectory(LocalScriptsDir);

        var localRaw = Directory
            .EnumerateFiles(LocalScriptsDir, "*.*", SearchOption.TopDirectoryOnly)
            .Where(p => EmwExtensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
            // Hide script_bootstrap from local list too (may exist from old versions that copied bundled scripts).
            .Where(p => !string.Equals(Path.GetFileNameWithoutExtension(p), "script_bootstrap", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var bundledRaw = new List<string>();
        if (Directory.Exists(BundledScriptsDir))
        {
            bundledRaw = Directory
                .EnumerateFiles(BundledScriptsDir, "*.*", SearchOption.TopDirectoryOnly)
                .Where(p => EmwExtensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
                // script_bootstrap.emw is an internal runtime dependency, not a user-facing script.
                .Where(p => !string.Equals(Path.GetFileNameWithoutExtension(p), "script_bootstrap", StringComparison.OrdinalIgnoreCase))
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

        var localNames = new HashSet<string>(
            local.Select(s => s.Name),
            StringComparer.OrdinalIgnoreCase
        );

        // If a local script exists with the same name, treat it as an override and don't show
        // the bundled one as a separate entry (avoids confusing duplicates).
        var bundledVisible = bundledRaw
            .Select(p => new ScriptInfo(Path.GetFileNameWithoutExtension(p), p, IsBundled: true, ShadowsBundled: false))
            .Where(s => !localNames.Contains(s.Name))
            .ToList();

        // Show bundled scripts first (macOS parity).
        var scripts = bundledVisible
            .Concat(local)
            .OrderByDescending(s => s.IsBundled)
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
        if (!safe.EndsWith(".emw", StringComparison.OrdinalIgnoreCase))
        {
            safe += ".emw";
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
        if (!safe.EndsWith(".emw", StringComparison.OrdinalIgnoreCase))
        {
            safe += ".emw";
        }

        var dest = Path.Combine(LocalScriptsDir, safe);
        if (File.Exists(dest))
        {
            throw new IOException("A script with that name already exists");
        }

        File.Move(script.FullPath, dest);
        return Task.FromResult(new ScriptInfo(Path.GetFileNameWithoutExtension(dest), dest, IsBundled: false, ShadowsBundled: false));
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
