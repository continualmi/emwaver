using System;
using System.Collections.Generic;
using System.IO;

namespace EMWaver.Services;

internal static class EnvBootstrap
{
    internal static void LoadForDevIfAvailable()
    {
        try
        {
            var root = FindRepoRoot(Directory.GetCurrentDirectory());
            if (root is null) return;

            var files = new[]
            {
                ".env",
            };

            var resolved = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var rel in files)
            {
                var path = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(path)) continue;

                foreach (var raw in File.ReadAllLines(path))
                {
                    var line = raw.Trim();
                    if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                    var idx = line.IndexOf('=');
                    if (idx <= 0) continue;

                    var key = line[..idx].Trim();
                    var val = line[(idx + 1)..].Trim();
                    if (string.IsNullOrEmpty(key)) continue;

                    val = Expand(val, resolved);

                    var existing = Environment.GetEnvironmentVariable(key);
                    if (string.IsNullOrEmpty(existing) && !resolved.ContainsKey(key))
                    {
                        Environment.SetEnvironmentVariable(key, val);
                        resolved[key] = val;
                    }
                    else if (!resolved.ContainsKey(key))
                    {
                        resolved[key] = existing ?? val;
                    }
                }
            }
        }
        catch
        {
            // best-effort only
        }
    }

    private static string Expand(string input, Dictionary<string, string> resolved)
    {
        var outVal = input;
        for (var i = 0; i < 4; i++)
        {
            var start = outVal.IndexOf("${", StringComparison.Ordinal);
            if (start < 0) break;
            var end = outVal.IndexOf('}', start + 2);
            if (end < 0) break;

            var key = outVal[(start + 2)..end];
            var repl = resolved.TryGetValue(key, out var v) ? v : (Environment.GetEnvironmentVariable(key) ?? "");
            outVal = outVal[..start] + repl + outVal[(end + 1)..];
        }
        return outVal;
    }

    private static string? FindRepoRoot(string start)
    {
        var dir = new DirectoryInfo(start);
        while (dir != null)
        {
            if (File.Exists(Path.Combine(dir.FullName, ".env"))) return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }
}
