using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class AppUpdateService
{
    internal static readonly Uri PrimaryManifestUri = new("https://emwaver.ai/updates/windows/latest.json");
    internal static readonly Uri FallbackManifestUri = new("https://github.com/continualmi/emwaver/releases/latest/download/emwaver-windows-update.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    private readonly HttpClient _http;

    internal AppUpdateService(HttpClient http)
    {
        _http = http;
    }

    internal async Task<AppUpdateCheckResult> CheckForUpdatesAsync(CancellationToken cancellationToken = default)
    {
        AppUpdateManifest? manifest = null;
        Exception? firstError = null;

        foreach (var uri in new[] { PrimaryManifestUri, FallbackManifestUri })
        {
            try
            {
                manifest = await FetchManifestAsync(uri, cancellationToken).ConfigureAwait(false);
                break;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException)
            {
                firstError ??= ex;
            }
        }

        if (manifest is null)
        {
            throw new InvalidOperationException("Could not load the EMWaver update manifest.", firstError);
        }

        if (string.IsNullOrWhiteSpace(manifest.Version))
        {
            throw new InvalidOperationException("The EMWaver update manifest is missing a version.");
        }

        if (!Uri.TryCreate(manifest.Url, UriKind.Absolute, out var downloadUri))
        {
            throw new InvalidOperationException("The EMWaver update manifest has an invalid installer URL.");
        }

        var currentVersion = ParseVersion(AppBuildInfo.ShortVersion);
        var updateVersion = ParseVersion(manifest.Version);
        var isNewer = updateVersion.CompareTo(currentVersion) > 0;

        return new AppUpdateCheckResult(
            IsUpdateAvailable: isNewer,
            CurrentVersion: AppBuildInfo.ShortVersion,
            Manifest: manifest with { Url = downloadUri.ToString() });
    }

    internal async Task<string> DownloadInstallerAsync(AppUpdateManifest manifest, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(manifest.Url, UriKind.Absolute, out var downloadUri))
        {
            throw new InvalidOperationException("The update installer URL is invalid.");
        }

        var fileName = Path.GetFileName(downloadUri.LocalPath);
        if (string.IsNullOrWhiteSpace(fileName) || !fileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            fileName = $"EMWaverSetup-{manifest.Version}.exe";
        }

        var updateDir = Path.Combine(Path.GetTempPath(), "EMWaver", "Updates", manifest.Version);
        Directory.CreateDirectory(updateDir);
        var destinationPath = Path.Combine(updateDir, fileName);
        var tempPath = destinationPath + ".download";

        using var response = await _http.GetAsync(downloadUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength;
        await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
        await using (var destination = File.Create(tempPath))
        {
            var buffer = new byte[128 * 1024];
            long downloaded = 0;
            while (true)
            {
                var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);
                if (read == 0) break;
                await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
                downloaded += read;
                if (totalBytes is > 0)
                {
                    progress?.Report(downloaded * 100.0 / totalBytes.Value);
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(manifest.Sha256))
        {
            var actualHash = await ComputeSha256Async(tempPath, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(actualHash, manifest.Sha256.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(tempPath);
                throw new InvalidOperationException("The downloaded installer did not match the expected SHA-256 hash.");
            }
        }

        File.Move(tempPath, destinationPath, overwrite: true);
        progress?.Report(100);
        return destinationPath;
    }

    internal void LaunchInstaller(string installerPath)
    {
        if (!File.Exists(installerPath))
        {
            throw new FileNotFoundException("The downloaded installer was not found.", installerPath);
        }

        Process.Start(new ProcessStartInfo(installerPath)
        {
            UseShellExecute = true,
            Arguments = "/SILENT /NORESTART /CLOSEAPPLICATIONS",
            Verb = "runas",
        });
    }

    private async Task<AppUpdateManifest> FetchManifestAsync(Uri uri, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(uri, cancellationToken).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        return await JsonSerializer.DeserializeAsync<AppUpdateManifest>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidOperationException("The update manifest was empty.");
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static Version ParseVersion(string version)
    {
        var clean = (version ?? string.Empty).Trim();
        var plus = clean.IndexOf('+');
        if (plus >= 0) clean = clean[..plus];
        var dash = clean.IndexOf('-');
        if (dash >= 0) clean = clean[..dash];

        return Version.TryParse(clean, out var parsed)
            ? parsed
            : new Version(0, 0, 0);
    }
}

internal sealed record AppUpdateCheckResult(
    bool IsUpdateAvailable,
    string CurrentVersion,
    AppUpdateManifest Manifest);

internal sealed record AppUpdateManifest
{
    [JsonPropertyName("version")]
    public string Version { get; init; } = "";

    [JsonPropertyName("url")]
    public string Url { get; init; } = "";

    [JsonPropertyName("sha256")]
    public string? Sha256 { get; init; }

    [JsonPropertyName("size")]
    public long? Size { get; init; }

    [JsonPropertyName("notes")]
    public string? Notes { get; init; }

    [JsonPropertyName("publishedAt")]
    public string? PublishedAt { get; init; }

    [JsonPropertyName("minimumSupportedVersion")]
    public string? MinimumSupportedVersion { get; init; }
}
