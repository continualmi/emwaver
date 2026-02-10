using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    private static void DebugLog(string msg)
    {
        System.Diagnostics.Debug.WriteLine("[EMWaver][CloudSync] " + msg);
    }

    internal sealed record FileKindSpec(string Kind, string Ext, string ContentType);

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

        foreach (var spec in kinds)
        {
            var cloud = await _api.ListAsync(kind: spec.Kind, ext: spec.Ext, accessToken: accessToken, ct: ct);
            var cloudByName = cloud
                .GroupBy(f => f.Metadata.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.Aggregate((best, candidate) => ChoosePreferredCloudFile(best, candidate)),
                    StringComparer.OrdinalIgnoreCase);

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

                if (localPath == null && cloudFile != null)
                {
                    // Cloud-only -> download.
                    DebugLog($"download (cloud-only) kind={spec.Kind} name='{name}' id={cloudFile.Metadata.Id}");
                    var destPath = Path.Combine(storageDir, name);
                    await DownloadAsync(baseUrl, accessToken, cloudName: name, cloudId: cloudFile.Metadata.Id, destPath: destPath, ct);
                    if (cloudFile.Metadata.MtimeMs is long cloudMtimeMs)
                    {
                        TrySetFileMtimeMs(destPath, cloudMtimeMs);
                    }
                    summary = summary with { Downloaded = summary.Downloaded + 1 };
                    continue;
                }

                if (localPath != null && cloudFile == null)
                {
                    // Local-only -> upload.
                    DebugLog($"upload (local-only) kind={spec.Kind} name='{name}' bytes={new FileInfo(localPath).Length}");
                    var bytes = await File.ReadAllBytesAsync(localPath, ct);
                    _ = await _api.UploadViaBackendAsync(
                        baseUrl,
                        accessToken,
                        spec.Kind,
                        name,
                        spec.ContentType,
                        bytes,
                        ct,
                        mtimeMs: TryGetFileMtimeMs(localPath));
                    summary = summary with { Uploaded = summary.Uploaded + 1 };
                    continue;
                }

                if (localPath != null && cloudFile != null)
                {
                    var localMtime = TryGetFileMtimeMs(localPath);
                    var cloudMtime = cloudFile.Metadata.MtimeMs;

                    if (localMtime is long lm && cloudMtime is long cm)
                    {
                        if (lm == cm)
                        {
                            continue;
                        }

                        if (lm > cm)
                        {
                            DebugLog($"upload (newer-local) kind={spec.Kind} name='{name}'");
                            var bytes = await File.ReadAllBytesAsync(localPath, ct);
                            _ = await _api.UploadViaBackendAsync(
                                baseUrl,
                                accessToken,
                                spec.Kind,
                                name,
                                spec.ContentType,
                                bytes,
                                ct,
                                mtimeMs: lm);
                            summary = summary with { Uploaded = summary.Uploaded + 1 };
                            continue;
                        }

                        DebugLog($"download (newer-cloud) kind={spec.Kind} name='{name}' id={cloudFile.Metadata.Id}");
                        try
                        {
                            await DownloadAsync(baseUrl, accessToken, cloudName: name, cloudId: cloudFile.Metadata.Id, localPath, ct);
                            TrySetFileMtimeMs(localPath, cm);
                            summary = summary with { Downloaded = summary.Downloaded + 1 };
                            continue;
                        }
                        catch (CloudFilesClient.CloudFilesClientError ex) when (ex.StatusCode == 404 || ex.StatusCode == 502)
                        {
                            // Cloud metadata exists but blob is missing/corrupt: overwrite cloud from local.
                            DebugLog($"download failed (HTTP {ex.StatusCode}) -> overwrite from local kind={spec.Kind} name='{name}'");
                            var bytes = await File.ReadAllBytesAsync(localPath, ct);
                            _ = await _api.UploadViaBackendAsync(
                                baseUrl,
                                accessToken,
                                spec.Kind,
                                name,
                                spec.ContentType,
                                bytes,
                                ct,
                                mtimeMs: lm);
                            summary = summary with { Uploaded = summary.Uploaded + 1 };
                            continue;
                        }
                    }

                    // Missing mtime on one side -> keep local as canonical to avoid destructive downloads.
                    DebugLog($"upload (missing-mtime) kind={spec.Kind} name='{name}'");
                    var localBytes = await File.ReadAllBytesAsync(localPath, ct);
                    _ = await _api.UploadViaBackendAsync(
                        baseUrl,
                        accessToken,
                        spec.Kind,
                        name,
                        spec.ContentType,
                        localBytes,
                        ct,
                        mtimeMs: localMtime ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                    summary = summary with { Uploaded = summary.Uploaded + 1 };
                }
            }
        }

        DebugLog($"sync done dir='{storageDir}' uploaded={summary.Uploaded} downloaded={summary.Downloaded} conflicts={summary.Conflicts}");
        return summary;
    }

    private static long? TryGetFileMtimeMs(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            if (!fi.Exists) return null;
            return new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeMilliseconds();
        }
        catch
        {
            return null;
        }
    }

    private static void TrySetFileMtimeMs(string path, long mtimeMs)
    {
        try
        {
            var dt = DateTimeOffset.FromUnixTimeMilliseconds(mtimeMs).UtcDateTime;
            File.SetLastWriteTimeUtc(path, dt);
        }
        catch
        {
        }
    }

    private async Task DownloadAsync(Uri baseUrl, string accessToken, string cloudName, string cloudId, string destPath, CancellationToken ct)
    {
        // Prefer legacy name-based endpoint when id is missing (older backend).
        byte[] bytes;
        if (string.IsNullOrWhiteSpace(cloudId))
        {
            bytes = await _api.DownloadContentByNameViaBackendAsync(baseUrl, accessToken, cloudName, ct);
        }
        else
        {
            bytes = await _api.DownloadContentViaBackendAsync(baseUrl, accessToken, cloudId, ct);
        }

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


    private static CloudFilesClient.CloudFile ChoosePreferredCloudFile(CloudFilesClient.CloudFile current, CloudFilesClient.CloudFile candidate)
    {
        var currentHasMtime = current.Metadata.MtimeMs.HasValue;
        var candidateHasMtime = candidate.Metadata.MtimeMs.HasValue;
        if (!currentHasMtime && candidateHasMtime) return candidate;
        if (currentHasMtime && !candidateHasMtime) return current;

        var currentSize = current.Metadata.SizeBytes;
        var candidateSize = candidate.Metadata.SizeBytes;
        return candidateSize >= currentSize ? candidate : current;
    }
}
