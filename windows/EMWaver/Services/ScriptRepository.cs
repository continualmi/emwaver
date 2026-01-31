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

        var local = localRaw
            .Select(p =>
            {
                var name = Path.GetFileNameWithoutExtension(p);
                return new ScriptInfo(name, p, IsBundled: false, ShadowsBundled: bundledNames.Contains(name));
            })
            .ToList();

        var bundled = bundledRaw
            .Select(p => new ScriptInfo(Path.GetFileNameWithoutExtension(p), p, IsBundled: true, ShadowsBundled: false))
            .ToList();

        // Show bundled scripts first (macOS parity) and keep any local copies visible.
        var scripts = bundled
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
