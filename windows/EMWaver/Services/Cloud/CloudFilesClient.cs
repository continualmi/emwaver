using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Cloud;

internal sealed class CloudFilesClient
{
    internal sealed record FileMetadata(
        string Id,
        string Name,
        string Extension,
        string Kind,
        string Etag,
        long SizeBytes,
        string? ContentType);

    internal sealed record CloudFile(FileMetadata Metadata, string Provider, string Container, string BlobKey);

    private readonly HttpClient _http;
    private readonly CloudConfig _cfg;
    private readonly CloudAuthManager _auth;

    internal CloudFilesClient(HttpClient http, CloudConfig cfg, CloudAuthManager auth)
    {
        _http = http;
        _cfg = cfg;
        _auth = auth;
    }

    private async Task<HttpRequestMessage> AuthedAsync(HttpMethod method, string path, CancellationToken ct)
    {
        var token = await _auth.EnsureSignedInAsync(ct);
        var req = new HttpRequestMessage(method, _cfg.BackendBaseUrl + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return req;
    }

    internal async Task<IReadOnlyList<CloudFile>> ListAsync(string? kind, string? ext, CancellationToken ct)
    {
        var qs = new List<string>();
        if (!string.IsNullOrWhiteSpace(kind)) qs.Add("kind=" + Uri.EscapeDataString(kind));
        if (!string.IsNullOrWhiteSpace(ext)) qs.Add("ext=" + Uri.EscapeDataString(ext));
        var path = "/v1/files" + (qs.Count > 0 ? ("?" + string.Join("&", qs)) : "");

        using var req = await AuthedAsync(HttpMethod.Get, path, ct);
        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("List files failed: " + json);
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var files = new List<CloudFile>();
        if (root.TryGetProperty("files", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var el in arr.EnumerateArray())
            {
                files.Add(ParseFile(el));
            }
        }

        return files;
    }

    internal sealed record InitUploadResult(CloudFile File, string UploadUrl);

    internal async Task<InitUploadResult> InitUploadAsync(string name, string kind, string? contentType, long sizeBytes, CancellationToken ct)
    {
        var payload = new
        {
            name = name,
            kind = kind,
            content_type = contentType,
            size_bytes = sizeBytes,
        };

        var body = JsonSerializer.Serialize(payload);
        using var req = await AuthedAsync(HttpMethod.Post, "/v1/files/init-upload", ct);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Init upload failed: " + json);
        }

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var file = ParseFile(root.GetProperty("file"));
        var uploadUrl = root.GetProperty("upload_url").GetString();
        if (string.IsNullOrWhiteSpace(uploadUrl))
        {
            throw new InvalidOperationException("Init upload missing upload_url");
        }

        return new InitUploadResult(file, uploadUrl!);
    }

    internal async Task CommitUploadAsync(string fileId, string expectedEtag, long sizeBytes, CancellationToken ct)
    {
        var payload = new
        {
            etag = expectedEtag,
            size_bytes = sizeBytes,
        };

        var body = JsonSerializer.Serialize(payload);
        using var req = await AuthedAsync(HttpMethod.Post, $"/v1/files/{Uri.EscapeDataString(fileId)}/commit-upload", ct);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Commit upload failed: " + json);
        }
    }

    internal async Task<string> GetDownloadUrlAsync(string fileId, CancellationToken ct)
    {
        using var req = await AuthedAsync(HttpMethod.Get, $"/v1/files/{Uri.EscapeDataString(fileId)}/download", ct);
        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Download URL failed: " + json);
        }

        using var doc = JsonDocument.Parse(json);
        var url = doc.RootElement.GetProperty("download_url").GetString();
        if (string.IsNullOrWhiteSpace(url))
        {
            throw new InvalidOperationException("Download response missing download_url");
        }
        return url!;
    }

    internal async Task UploadBytesToSasAsync(string uploadUrl, byte[] bytes, string? contentType, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Put, uploadUrl);
        req.Content = new ByteArrayContent(bytes);
        req.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType ?? "application/octet-stream");

        // Azure Blob Put Blob requires x-ms-blob-type.
        req.Headers.TryAddWithoutValidation("x-ms-blob-type", "BlockBlob");

        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("Blob upload failed: " + body);
        }
    }

    private static CloudFile ParseFile(JsonElement el)
    {
        var md = el.GetProperty("metadata");
        var st = el.GetProperty("storage");

        var meta = new FileMetadata(
            Id: md.GetProperty("id").GetString() ?? "",
            Name: md.GetProperty("name").GetString() ?? "",
            Extension: md.GetProperty("extension").GetString() ?? "",
            Kind: md.GetProperty("kind").GetString() ?? "",
            Etag: md.GetProperty("etag").GetString() ?? "",
            SizeBytes: md.TryGetProperty("size_bytes", out var sb) ? sb.GetInt64() : 0,
            ContentType: md.TryGetProperty("content_type", out var ct) ? ct.GetString() : null
        );

        return new CloudFile(
            Metadata: meta,
            Provider: st.GetProperty("provider").GetString() ?? "",
            Container: st.GetProperty("container").GetString() ?? "",
            BlobKey: st.GetProperty("blob_key").GetString() ?? ""
        );
    }
}
