using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Storage;

namespace EMWaver.Services.Agent;

internal sealed class AgentApiKeyStore
{
    private const string KeyApiKey = "agent.emwaver.apiKey";
    private const string PersistFileName = "agent_api_key.json";

    private string? _apiKey;

    internal event Action? Changed;

    private sealed record Persisted(string? ApiKey);

    internal AgentApiKeyStore()
    {
        TryLoadPersisted(PersistFileName);
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            _apiKey = TryReadLocalSetting(KeyApiKey);
        }

        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            PersistCredential();
        }
    }

    internal bool HasAgentKey => !string.IsNullOrWhiteSpace(GetApiKey());

    internal string? GetApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            return _apiKey;
        }

        _apiKey = TryReadLocalSetting(KeyApiKey);
        return string.IsNullOrWhiteSpace(_apiKey) ? null : _apiKey;
    }

    internal async Task<string> SaveApiKeyAsync(string apiKey, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var trimmed = (apiKey ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            throw new InvalidOperationException("Enter an Agent API key.");
        }

        await Task.CompletedTask;
        _apiKey = trimmed;
        PersistCredential();
        Changed?.Invoke();
        return _apiKey;
    }

    internal void Clear()
    {
        _apiKey = null;
        TryRemoveLocalSetting(KeyApiKey);
        TryDeletePersisted(PersistFileName);
        Changed?.Invoke();
    }

    private void PersistCredential()
    {
        TryWriteLocalSetting(KeyApiKey, _apiKey);
        TrySavePersisted(PersistFileName);
    }

    private static string? TryReadLocalSetting(string key)
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            return ls.Values.TryGetValue(key, out var v) ? v as string : null;
        }
        catch
        {
            return null;
        }
    }

    private static void TryWriteLocalSetting(string key, string? value)
    {
        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            if (string.IsNullOrWhiteSpace(value)) ls.Values.Remove(key);
            else ls.Values[key] = value;
        }
        catch
        {
        }
    }

    private static void TryRemoveLocalSetting(string key)
    {
        try { ApplicationData.Current.LocalSettings.Values.Remove(key); }
        catch { }
    }

    private static string PersistPath(string fileName)
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EMWaver");
        return Path.Combine(dir, fileName);
    }

    private void TryLoadPersisted(string fileName)
    {
        try
        {
            var path = PersistPath(fileName);
            if (!File.Exists(path)) return;
            var data = JsonSerializer.Deserialize<Persisted>(File.ReadAllText(path));
            if (!string.IsNullOrWhiteSpace(data?.ApiKey))
            {
                _apiKey = data.ApiKey;
            }
        }
        catch
        {
        }
    }

    private void TrySavePersisted(string fileName)
    {
        try
        {
            var path = PersistPath(fileName);
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            File.WriteAllText(path, JsonSerializer.Serialize(new Persisted(_apiKey)));
        }
        catch
        {
        }
    }

    private static void TryDeletePersisted(string fileName)
    {
        try
        {
            var path = PersistPath(fileName);
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
        }
    }
}
