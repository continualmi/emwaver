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
    internal sealed class CloudFilesClientError : Exception
    {
        internal int StatusCode { get; }
        internal CloudFilesClientError(int statusCode, string message) : base(message)
        {
            StatusCode = statusCode;
        }
    }

    internal sealed record FileMetadata(
        string Id,
        string Name,
        string Extension,
        string Kind,
        string Etag,
        long SizeBytes,
        string? ContentType,
        string? Sha256);

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

    private async Task<HttpRequestMessage> MakeRequestAsync(HttpMethod method, string path, string? accessToken, CancellationToken ct)
    {
        var token = accessToken;
        if (token == null)
        {
            token = await _auth.EnsureSignedInAsync(ct);
        }

        var req = new HttpRequestMessage(method, _cfg.BackendBaseUrl + path);
        if (!string.IsNullOrWhiteSpace(token))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return req;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage res, CancellationToken ct, string op)
    {
        if (res.IsSuccessStatusCode)
        {
            return;
        }

        var body = await res.Content.ReadAsStringAsync(ct);
        throw new CloudFilesClientError((int)res.StatusCode, $"{op} failed: {body}");
    }

    internal async Task<IReadOnlyList<CloudFile>> ListAsync(string? kind, string? ext, string? accessToken, CancellationToken ct)
    {
        var qs = new List<string>();
        if (!string.IsNullOrWhiteSpace(kind)) qs.Add("kind=" + Uri.EscapeDataString(kind));
        if (!string.IsNullOrWhiteSpace(ext)) qs.Add("ext=" + Uri.EscapeDataString(ext));
        var path = "/v1/files" + (qs.Count > 0 ? ("?" + string.Join("&", qs)) : "");

        using var req = await MakeRequestAsync(HttpMethod.Get, path, accessToken, ct);
        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudFilesClientError((int)res.StatusCode, "List files failed: " + json);
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

    internal async Task<InitUploadResult> InitUploadAsync(string name, string kind, string? contentType, long sizeBytes, string? accessToken, CancellationToken ct)
    {
        var payload = new
        {
            name = name,
            kind = kind,
            content_type = contentType,
            size_bytes = sizeBytes,
        };

        var body = JsonSerializer.Serialize(payload);
        using var req = await MakeRequestAsync(HttpMethod.Post, "/v1/files/init-upload", accessToken, ct);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudFilesClientError((int)res.StatusCode, "Init upload failed: " + json);
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

    internal async Task CommitUploadAsync(string fileId, string expectedEtag, long sizeBytes, string? accessToken, CancellationToken ct)
    {
        var payload = new
        {
            etag = expectedEtag,
            size_bytes = sizeBytes,
        };

        var body = JsonSerializer.Serialize(payload);
        using var req = await MakeRequestAsync(HttpMethod.Post, $"/v1/files/{Uri.EscapeDataString(fileId)}/commit-upload", accessToken, ct);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudFilesClientError((int)res.StatusCode, "Commit upload failed: " + json);
        }
    }

    internal async Task<string> GetDownloadUrlAsync(string fileId, string? accessToken, CancellationToken ct)
    {
        using var req = await MakeRequestAsync(HttpMethod.Get, $"/v1/files/{Uri.EscapeDataString(fileId)}/download", accessToken, ct);
        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudFilesClientError((int)res.StatusCode, "Download URL failed: " + json);
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
            throw new CloudFilesClientError((int)res.StatusCode, "Blob upload failed: " + body);
        }
    }

    internal async Task<CloudFileMetadata> UploadViaBackendAsync(Uri baseUrl, string accessToken, string kind, string name, string contentType, byte[] bytes, CancellationToken ct)
    {
        // POST /v1/files/upload { kind, name, content_type, data_base64, size_bytes }
        var payload = new
        {
            kind = kind,
            name = name,
            content_type = contentType,
            data_base64 = Convert.ToBase64String(bytes),
            size_bytes = (long)bytes.Length,
        };

        var body = JsonSerializer.Serialize(payload);
        using var req = await MakeRequestAsync(HttpMethod.Post, "/v1/files/upload", accessToken, ct);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");

        using var res = await _http.SendAsync(req, ct);
        var json = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
        {
            throw new CloudFilesClientError((int)res.StatusCode, "Upload via backend failed: " + json);
        }

        using var doc = JsonDocument.Parse(json);
        var file = ParseFile(doc.RootElement.GetProperty("file"));
        return new CloudFileMetadata(file.Metadata);
    }

    internal async Task<byte[]> DownloadContentViaBackendAsync(Uri baseUrl, string accessToken, string fileId, CancellationToken ct)
    {
        using var req = await MakeRequestAsync(HttpMethod.Get, $"/v1/files/{Uri.EscapeDataString(fileId)}/content", accessToken, ct);
        using var res = await _http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new CloudFilesClientError((int)res.StatusCode, "Download content failed: " + body);
        }
        return await res.Content.ReadAsByteArrayAsync(ct);
    }

    internal sealed record CloudFileMetadata(FileMetadata Metadata);

    private static CloudFile ParseFile(JsonElement el)
    {
        // Backend file JSON can be either:
        // - { metadata: { ... }, storage: { ... } }
        // - { id: ..., name: ..., ... } (metadata-only)
        var md = el;
        if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty("metadata", out var wrappedMd) && wrappedMd.ValueKind == JsonValueKind.Object)
        {
            md = wrappedMd;
        }

        // Some backend endpoints (or older backend versions) may omit storage details.
        // Windows sync only needs metadata, so tolerate missing storage.
        el.TryGetProperty("storage", out var st);

        static string GetString(JsonElement obj, string prop)
        {
            return (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                ? (v.GetString() ?? "")
                : "";
        }

        static string? GetStringOrNull(JsonElement obj, string prop)
        {
            return (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                ? v.GetString()
                : null;
        }

        static long GetInt64(JsonElement obj, string prop)
        {
            if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(prop, out var v))
            {
                if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n)) return n;
                if (v.ValueKind == JsonValueKind.String && long.TryParse(v.GetString(), out var s)) return s;
            }
            return 0;
        }

        var meta = new FileMetadata(
            Id: GetString(md, "id"),
            Name: GetString(md, "name"),
            Extension: GetString(md, "extension"),
            Kind: GetString(md, "kind"),
            Etag: GetString(md, "etag"),
            SizeBytes: GetInt64(md, "size_bytes"),
            ContentType: GetStringOrNull(md, "content_type"),
            Sha256: GetStringOrNull(md, "sha256")
        );

        string provider = "";
        string container = "";
        string blobKey = "";

        if (st.ValueKind == JsonValueKind.Object)
        {
            provider = st.TryGetProperty("provider", out var p) ? (p.GetString() ?? "") : "";
            container = st.TryGetProperty("container", out var c) ? (c.GetString() ?? "") : "";
            blobKey = st.TryGetProperty("blob_key", out var b) ? (b.GetString() ?? "") : "";
        }

        return new CloudFile(
            Metadata: meta,
            Provider: provider,
            Container: container,
            BlobKey: blobKey
        );
    }
}
