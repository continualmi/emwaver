using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services.Agent;

public sealed class AgentApiKeyStore
{
    private const string PersistFileName = "agent_api_key.json";

    private string? _apiKey;

    internal event Action? Changed;

    private sealed record Persisted(string? ApiKey);

    internal AgentApiKeyStore()
    {
        TryLoadPersisted(PersistFileName);
        if (string.IsNullOrWhiteSpace(_apiKey))
        {
            _apiKey = Environment.GetEnvironmentVariable("EMWAVER_AGENT_API_KEY")?.Trim();
        }
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            PersistCredential();
        }
    }

    internal bool HasAgentKey => !string.IsNullOrWhiteSpace(GetApiKey());

    public void SetApiKey(string apiKey)
    {
        SaveApiKeyAsync(apiKey, CancellationToken.None).GetAwaiter().GetResult();
    }

    internal string? GetApiKey()
    {
        if (!string.IsNullOrWhiteSpace(_apiKey))
        {
            return _apiKey;
        }

        return null;
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
        TryDeletePersisted(PersistFileName);
        Changed?.Invoke();
    }

    private void PersistCredential()
    {
        TrySavePersisted(PersistFileName);
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
