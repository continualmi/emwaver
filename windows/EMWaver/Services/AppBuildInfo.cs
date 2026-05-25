using System;
using System.Diagnostics;
using System.Reflection;

namespace EMWaver.Services;

internal static class AppBuildInfo
{
    private static readonly Assembly Assembly = typeof(AppBuildInfo).Assembly;

    internal static string Version =>
        Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? FileVersionInfo.GetVersionInfo(Assembly.Location).ProductVersion
        ?? Assembly.GetName().Version?.ToString()
        ?? "unknown";

    internal static string ShortVersion
    {
        get
        {
            var version = Version.Trim();
            if (string.IsNullOrWhiteSpace(version)) return "unknown";

            var plus = version.IndexOf('+');
            if (plus < 0) return version;

            var baseVersion = version[..plus];
            var metadata = ShortMetadata(version[(plus + 1)..]);

            return string.IsNullOrWhiteSpace(metadata) ? baseVersion : $"{baseVersion}+{metadata}";
        }
    }

    internal static string DiagnosticsLine => $"EMWaver Windows app {Version}";

    private static string ShortMetadata(string metadata)
    {
        metadata = (metadata ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(metadata)) return string.Empty;

        // Local SDK builds may append the git SourceRevisionId to our "local" marker,
        // producing metadata like "local.7ccf958...". For support reports, show the
        // useful commit id instead of truncating that to "local.7".
        if (metadata.StartsWith("local.", StringComparison.OrdinalIgnoreCase))
        {
            var revision = metadata["local.".Length..];
            return string.IsNullOrWhiteSpace(revision) ? "local" : Truncate(revision, 7);
        }

        return Truncate(metadata, 7);
    }

    private static string Truncate(string value, int maxLength)
    {
        value = (value ?? string.Empty).Trim();
        if (value.Length <= maxLength) return value;
        return value[..maxLength];
    }
}
