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

        if (!Directory.Exists(BundledScriptsDir))
        {
            // In dev, the bundled scripts should be copied by MSBuild.
            // If missing, just keep going; listing will show local scripts only.
            return;
        }

        // One-way seed: copy bundled scripts into the local scripts dir if missing.
        // We don't overwrite user's local edits.
        foreach (var path in Directory.EnumerateFiles(BundledScriptsDir, "*.emw", SearchOption.TopDirectoryOnly))
        {
            var name = Path.GetFileName(path);
            var dest = Path.Combine(LocalScriptsDir, name);
            if (File.Exists(dest))
            {
                continue;
            }

            await using var src = File.OpenRead(path);
            await using var dst = File.Create(dest);
            await src.CopyToAsync(dst);
        }
    }

    internal Task<IReadOnlyList<ScriptInfo>> ListScriptsAsync()
    {
        Directory.CreateDirectory(LocalScriptsDir);

        var scripts = Directory
            .EnumerateFiles(LocalScriptsDir, "*.*", SearchOption.TopDirectoryOnly)
            .Where(p => EmwExtensions.Contains(Path.GetExtension(p), StringComparer.OrdinalIgnoreCase))
            .Select(p => new ScriptInfo(Path.GetFileNameWithoutExtension(p), p, IsBundled: false))
            .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return Task.FromResult<IReadOnlyList<ScriptInfo>>(scripts);
    }
}
