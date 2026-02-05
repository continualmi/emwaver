using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Diagnostics;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal enum CloudSyncPolicy
{
    PreferLocal,
}

internal sealed record CloudSyncSummary(int Uploaded, int Downloaded, int Conflicts)
{
    internal static CloudSyncSummary Empty => new(0, 0, 0);

    internal CloudSyncSummary Add(CloudSyncSummary other) => new(
        Uploaded + other.Uploaded,
        Downloaded + other.Downloaded,
        Conflicts + other.Conflicts
    );
}

internal sealed class CloudSyncEngine
{
    private static bool DebugEnabled()
    {
        return string.Equals(Environment.GetEnvironmentVariable("EMWAVER_SYNC_DEBUG")?.Trim(), "1", StringComparison.OrdinalIgnoreCase);
    }

    private static void DebugLog(string msg)
    {
        if (!DebugEnabled()) return;
        System.Diagnostics.Debug.WriteLine("[EMWaver][CloudSync] " + msg);
    }

    internal sealed record FileKindSpec(string Kind, string Ext, string ContentType);

    private sealed record IndexEntry(
        string Kind,
        string Name,
        string CloudId,
        string? LastSyncedLocalEtag,
        string? LastSyncedCloudEtag,
        string? LastSyncedLocalSha256,
        string? LastSyncedCloudSha256
    );

    private sealed record IndexFile(int Version, List<IndexEntry> Entries);

    private readonly CloudFilesClient _api;

    internal CloudSyncEngine(CloudFilesClient api)
    {
        _api = api;
    }

    internal async Task<CloudSyncSummary> SyncAsync(
        Uri baseUrl,
        string accessToken,
        string storageDir,
        IReadOnlyList<FileKindSpec> kinds,
        CloudSyncPolicy policy,
        CancellationToken ct)
    {
        // Empty accessToken is allowed in dev when backend auth is disabled (EMWAVER_ALLOW_ANON_SYNC=1).
        // Caller decides whether that is acceptable.

        Directory.CreateDirectory(storageDir);

        DebugLog($"sync start dir='{storageDir}' kinds={kinds.Count} token={(string.IsNullOrWhiteSpace(accessToken) ? "<empty>" : "<present>")}");

        var summary = CloudSyncSummary.Empty;
        var index = await LoadIndexAsync(storageDir, ct);

        foreach (var spec in kinds)
        {
            var cloud = await _api.ListAsync(kind: spec.Kind, ext: spec.Ext, accessToken: accessToken, ct: ct);
            var cloudByName = cloud.ToDictionary(f => f.Metadata.Name, f => f, StringComparer.OrdinalIgnoreCase);

            DebugLog($"kind={spec.Kind} ext={spec.Ext} cloud={cloudByName.Count}");

            var localFiles = Directory
                .EnumerateFiles(storageDir, "*" + spec.Ext, SearchOption.TopDirectoryOnly)
                .Select(p => new FileInfo(p))
                .Where(fi => fi.Exists)
                .ToList();
            DebugLog($"kind={spec.Kind} ext={spec.Ext} local={localFiles.Count}");
            var localByName = localFiles.ToDictionary(fi => fi.Name, fi => fi.FullName, StringComparer.OrdinalIgnoreCase);

            var names = new HashSet<string>(cloudByName.Keys, StringComparer.OrdinalIgnoreCase);
            foreach (var n in localByName.Keys) names.Add(n);

            foreach (var name in names.OrderBy(n => n, StringComparer.OrdinalIgnoreCase))
            {
                ct.ThrowIfCancellationRequested();

                localByName.TryGetValue(name, out var localPath);
                cloudByName.TryGetValue(name, out var cloudFile);

                if (cloudFile != null)
                {
                    index = UpsertIndex(index, spec.Kind, name, cloudFile.Metadata.Id, cloudFile.Metadata.Etag, cloudFile.Metadata.Sha256);
                }

                var entry = index.Entries.FirstOrDefault(e =>
                    string.Equals(e.Kind, spec.Kind, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(e.Name, name, StringComparison.OrdinalIgnoreCase));

                var localEtag = localPath != null ? TryComputeLocalEtag(localPath) : null;
                var localSha = localPath != null ? TryComputeLocalSha256(localPath) : null;

                var cloudEtag = cloudFile?.Metadata.Etag;
                var cloudSha = cloudFile?.Metadata.Sha256;

                if (localPath == null && cloudFile != null)
                {
                    // Cloud-only -> download.
                    DebugLog($"download (cloud-only) kind={spec.Kind} name='{name}' id={cloudFile.Metadata.Id}");
                    await DownloadAsync(baseUrl, accessToken, cloudFile.Metadata.Id, destPath: Path.Combine(storageDir, name), ct);
                    summary = summary with { Downloaded = summary.Downloaded + 1 };

                    var dest = Path.Combine(storageDir, name);
                    index = UpdateIndexAfterSync(index, spec.Kind, name,
                        localEtag: TryComputeLocalEtag(dest),
                        cloudEtag: cloudFile.Metadata.Etag,
                        localSha256: TryComputeLocalSha256(dest),
                        cloudSha256: cloudFile.Metadata.Sha256);

                    continue;
                }

                if (localPath != null && cloudFile == null)
                {
                    // Local-only -> upload.
                    DebugLog($"upload (local-only) kind={spec.Kind} name='{name}' bytes={new FileInfo(localPath).Length}");
                    var bytes = await File.ReadAllBytesAsync(localPath, ct);
                    var uploaded = await _api.UploadViaBackendAsync(baseUrl, accessToken, spec.Kind, name, spec.ContentType, bytes, ct);
                    summary = summary with { Uploaded = summary.Uploaded + 1 };

                    index = UpsertIndex(index, spec.Kind, name, uploaded.Metadata.Id, uploaded.Metadata.Etag, uploaded.Metadata.Sha256);
                    index = UpdateIndexAfterSync(index, spec.Kind, name,
                        localEtag: localEtag,
                        cloudEtag: uploaded.Metadata.Etag,
                        localSha256: localSha,
                        cloudSha256: uploaded.Metadata.Sha256);

                    continue;
                }

                if (localPath != null && cloudFile != null)
                {
                    // Both exist.
                    var lastLocalEtag = entry?.LastSyncedLocalEtag;
                    var lastCloudEtag = entry?.LastSyncedCloudEtag;
                    var lastLocalSha = entry?.LastSyncedLocalSha256;
                    var lastCloudSha = entry?.LastSyncedCloudSha256;

                    bool LocalChanged()
                    {
                        if (!string.IsNullOrWhiteSpace(localSha) && !string.IsNullOrWhiteSpace(lastLocalSha))
                        {
                            return !string.Equals(localSha, lastLocalSha, StringComparison.OrdinalIgnoreCase);
                        }

                        if (lastLocalEtag == null) return localEtag != null;
                        return !string.Equals(localEtag, lastLocalEtag, StringComparison.Ordinal);
                    }

                    bool CloudChanged()
                    {
                        if (!string.IsNullOrWhiteSpace(cloudSha) && !string.IsNullOrWhiteSpace(lastCloudSha))
                        {
                            return !string.Equals(cloudSha, lastCloudSha, StringComparison.OrdinalIgnoreCase);
                        }

                        if (lastCloudEtag == null) return cloudEtag != null;
                        return !string.Equals(cloudEtag, lastCloudEtag, StringComparison.Ordinal);
                    }

                    // If we have both hashes and they match, nothing to do.
                    if (!string.IsNullOrWhiteSpace(localSha) && !string.IsNullOrWhiteSpace(cloudSha)
                        && string.Equals(localSha, cloudSha, StringComparison.OrdinalIgnoreCase))
                    {
                        index = UpsertIndex(index, spec.Kind, name, cloudFile.Metadata.Id, cloudFile.Metadata.Etag, cloudSha);
                        index = UpdateIndexAfterSync(index, spec.Kind, name,
                            localEtag: localEtag,
                            cloudEtag: cloudFile.Metadata.Etag,
                            localSha256: localSha,
                            cloudSha256: cloudSha);
                        continue;
                    }

                    var hasHistory = lastLocalSha != null || lastCloudSha != null || lastLocalEtag != null || lastCloudEtag != null;
                    var treatAsConflict = !hasHistory
                        && !string.IsNullOrWhiteSpace(localSha)
                        && !string.IsNullOrWhiteSpace(cloudSha)
                        && !string.Equals(localSha, cloudSha, StringComparison.OrdinalIgnoreCase);

                    var localChanged = LocalChanged();
                    var cloudChanged = CloudChanged();

                    if (treatAsConflict || (localChanged && cloudChanged))
                    {
                        DebugLog($"conflict kind={spec.Kind} name='{name}' localChanged={localChanged} cloudChanged={cloudChanged} hasHistory={hasHistory}");
                        if (policy == CloudSyncPolicy.PreferLocal)
                        {
                            var conflictPath = Path.Combine(storageDir, MakeConflictName(name, suffix: "cloud"));
                            DebugLog($"download (conflict copy) => '{conflictPath}'");
                            await DownloadAsync(baseUrl, accessToken, cloudFile.Metadata.Id, conflictPath, ct);
                            summary = summary with
                            {
                                Conflicts = summary.Conflicts + 1,
                                Downloaded = summary.Downloaded + 1,
                            };
                        }
                    }
                    else if (localChanged && !cloudChanged)
                    {
                        DebugLog($"upload (local-changed) kind={spec.Kind} name='{name}'");
                        var bytes = await File.ReadAllBytesAsync(localPath, ct);
                        _ = await _api.UploadViaBackendAsync(baseUrl, accessToken, spec.Kind, name, spec.ContentType, bytes, ct);
                        summary = summary with { Uploaded = summary.Uploaded + 1 };
                    }
                    else if (!localChanged && cloudChanged)
                    {
                        DebugLog($"download (cloud-changed) kind={spec.Kind} name='{name}' id={cloudFile.Metadata.Id}");
                        try
                        {
                            await DownloadAsync(baseUrl, accessToken, cloudFile.Metadata.Id, localPath, ct);
                            summary = summary with { Downloaded = summary.Downloaded + 1 };

                            index = UpdateIndexAfterSync(index, spec.Kind, name,
                                localEtag: TryComputeLocalEtag(localPath),
                                cloudEtag: cloudFile.Metadata.Etag,
                                localSha256: TryComputeLocalSha256(localPath),
                                cloudSha256: cloudFile.Metadata.Sha256);
                        }
                        catch (CloudFilesClient.CloudFilesClientError ex) when (ex.StatusCode == 404 || ex.StatusCode == 502)
                        {
                            // Cloud metadata exists but blob is missing/corrupt: overwrite cloud from local.
                            DebugLog($"download failed (HTTP {ex.StatusCode}) -> overwrite from local kind={spec.Kind} name='{name}'");
                            var bytes = await File.ReadAllBytesAsync(localPath, ct);
                            _ = await _api.UploadViaBackendAsync(baseUrl, accessToken, spec.Kind, name, spec.ContentType, bytes, ct);
                            summary = summary with { Uploaded = summary.Uploaded + 1 };
                        }
                    }

                    // Refresh stored mapping.
                    index = UpsertIndex(index, spec.Kind, name, cloudFile.Metadata.Id, cloudFile.Metadata.Etag, cloudFile.Metadata.Sha256);
                    index = UpdateIndexAfterSync(index, spec.Kind, name,
                        localEtag: localEtag,
                        cloudEtag: cloudFile.Metadata.Etag,
                        localSha256: localSha,
                        cloudSha256: cloudFile.Metadata.Sha256);
                }
            }
        }

        await SaveIndexAsync(index, storageDir, ct);
        DebugLog($"sync done dir='{storageDir}' uploaded={summary.Uploaded} downloaded={summary.Downloaded} conflicts={summary.Conflicts}");
        return summary;
    }

    private static string? TryComputeLocalEtag(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) return null;
            var unix = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
            return unix.ToString();
        }
        catch
        {
            return null;
        }
    }

    private static string? TryComputeLocalSha256(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(stream);
            return Convert.ToHexString(hash).ToLowerInvariant();
        }
        catch
        {
            return null;
        }
    }

    private async Task DownloadAsync(Uri baseUrl, string accessToken, string fileId, string destPath, CancellationToken ct)
    {
        var bytes = await _api.DownloadContentViaBackendAsync(baseUrl, accessToken, fileId, ct);

        Directory.CreateDirectory(Path.GetDirectoryName(destPath) ?? ".");

        // Atomic-ish write
        var tmp = destPath + ".tmp." + Guid.NewGuid().ToString("n");
        await File.WriteAllBytesAsync(tmp, bytes, ct);

        if (File.Exists(destPath))
        {
            File.Replace(tmp, destPath, destinationBackupFileName: null);
        }
        else
        {
            File.Move(tmp, destPath);
        }
    }

    // MARK: - Index

    private static string IndexPath(string storageDir) => Path.Combine(storageDir, ".cloud_sync_index.json");

    private static async Task<IndexFile> LoadIndexAsync(string storageDir, CancellationToken ct)
    {
        try
        {
            var path = IndexPath(storageDir);
            if (!File.Exists(path))
            {
                return new IndexFile(Version: 2, Entries: new List<IndexEntry>());
            }

            var json = await File.ReadAllTextAsync(path, ct);
            var decoded = JsonSerializer.Deserialize<IndexFile>(json);
            return decoded ?? new IndexFile(Version: 2, Entries: new List<IndexEntry>());
        }
        catch
        {
            return new IndexFile(Version: 2, Entries: new List<IndexEntry>());
        }
    }

    private static async Task SaveIndexAsync(IndexFile index, string storageDir, CancellationToken ct)
    {
        var path = IndexPath(storageDir);
        var json = JsonSerializer.Serialize(index, new JsonSerializerOptions { WriteIndented = false });
        await File.WriteAllTextAsync(path, json, ct);
    }

    private static IndexFile UpsertIndex(IndexFile index, string kind, string name, string cloudId, string? cloudEtag, string? cloudSha256)
    {
        var entries = index.Entries.ToList();
        var i = entries.FindIndex(e =>
            string.Equals(e.Kind, kind, StringComparison.OrdinalIgnoreCase)
            && string.Equals(e.Name, name, StringComparison.OrdinalIgnoreCase));

        if (i >= 0)
        {
            var existing = entries[i];
            entries[i] = existing with
            {
                CloudId = cloudId,
                LastSyncedCloudEtag = existing.LastSyncedCloudEtag ?? cloudEtag,
                LastSyncedCloudSha256 = existing.LastSyncedCloudSha256 ?? cloudSha256,
            };
        }
        else
        {
            entries.Add(new IndexEntry(
                Kind: kind,
                Name: name,
                CloudId: cloudId,
                LastSyncedLocalEtag: null,
                LastSyncedCloudEtag: cloudEtag,
                LastSyncedLocalSha256: null,
                LastSyncedCloudSha256: cloudSha256
            ));
        }

        return index with { Entries = entries };
    }

    private static IndexFile UpdateIndexAfterSync(
        IndexFile index,
        string kind,
        string name,
        string? localEtag,
        string? cloudEtag,
        string? localSha256,
        string? cloudSha256)
    {
        var entries = index.Entries.ToList();
        var i = entries.FindIndex(e =>
            string.Equals(e.Kind, kind, StringComparison.OrdinalIgnoreCase)
            && string.Equals(e.Name, name, StringComparison.OrdinalIgnoreCase));

        if (i < 0)
        {
            return index;
        }

        var existing = entries[i];
        entries[i] = existing with
        {
            LastSyncedLocalEtag = localEtag,
            LastSyncedCloudEtag = cloudEtag,
            LastSyncedLocalSha256 = localSha256,
            LastSyncedCloudSha256 = cloudSha256,
        };

        return index with { Entries = entries };
    }

    private static string MakeConflictName(string original, string suffix)
    {
        var baseName = Path.GetFileNameWithoutExtension(original);
        var ext = Path.GetExtension(original);
        var stamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return string.IsNullOrEmpty(ext)
            ? $"{baseName}.conflict_{suffix}_{stamp}"
            : $"{baseName}.conflict_{suffix}_{stamp}{ext}";
    }
}
