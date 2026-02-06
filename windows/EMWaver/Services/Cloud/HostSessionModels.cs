using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EMWaver.Services.Cloud;

internal sealed record HostSession(
    string Id,
    string Platform,
    string DeviceName,
    string AppVersion,
    Dictionary<string, JsonElement> Capabilities,
    Dictionary<string, JsonElement> Status,
    long CreatedAtMs,
    long LastSeenAtMs,
    bool Online)
{
    internal bool UsbConnected => TryGetBool(Status, "usb_connected");
    internal string ConnectedPort => TryGetString(Status, "connected_port");
    internal bool ScriptRunning => TryGetBool(Status, "script_running");
    internal string ActiveScriptName => TryGetString(Status, "active_script_name");

    private static bool TryGetBool(Dictionary<string, JsonElement> map, string key)
    {
        try
        {
            if (map.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.True) return true;
            if (map.TryGetValue(key, out v) && v.ValueKind == JsonValueKind.False) return false;
        }
        catch { }
        return false;
    }

    private static string TryGetString(Dictionary<string, JsonElement> map, string key)
    {
        try
        {
            if (map.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString() ?? "";
            }
        }
        catch { }
        return "";
    }
}

internal sealed record HostSessionsResponse(
    [property: JsonPropertyName("hosts")] List<HostSessionDto>? Hosts,
    [property: JsonPropertyName("now_ms")] long NowMs)
{
    internal List<HostSession> ToModel()
    {
        var outList = new List<HostSession>();
        if (Hosts == null) return outList;
        foreach (var h in Hosts)
        {
            outList.Add(h.ToModel());
        }
        return outList;
    }
}

internal sealed record HostSessionDto(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("platform")] string? Platform,
    [property: JsonPropertyName("device_name")] string? DeviceName,
    [property: JsonPropertyName("app_version")] string? AppVersion,
    [property: JsonPropertyName("capabilities")] Dictionary<string, JsonElement>? Capabilities,
    [property: JsonPropertyName("status")] Dictionary<string, JsonElement>? Status,
    [property: JsonPropertyName("created_at_ms")] long CreatedAtMs,
    [property: JsonPropertyName("last_seen_at_ms")] long LastSeenAtMs,
    [property: JsonPropertyName("online")] bool Online)
{
    internal HostSession ToModel() => new(
        Id: (Id ?? "").Trim(),
        Platform: (Platform ?? "unknown").Trim(),
        DeviceName: (DeviceName ?? "").Trim(),
        AppVersion: (AppVersion ?? "").Trim(),
        Capabilities: Capabilities ?? new(),
        Status: Status ?? new(),
        CreatedAtMs: CreatedAtMs,
        LastSeenAtMs: LastSeenAtMs,
        Online: Online
    );
}
