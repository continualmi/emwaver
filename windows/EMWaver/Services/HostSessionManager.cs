using System;
using System.IO;
using Windows.Storage;

namespace EMWaver.Services;

internal sealed class HostSessionManager
{
    private const string HostSessionIdKey = "emwaver.hostSessionId";
    internal string HostSessionId { get; }

    internal HostSessionManager()
    {
        HostSessionId = GetOrCreateHostSessionId();
    }

    private static string GetOrCreateHostSessionId()
    {
        var fileId = ReadHostSessionIdFromFile();
        if (!string.IsNullOrWhiteSpace(fileId))
        {
            return fileId!;
        }

        try
        {
            var ls = ApplicationData.Current.LocalSettings;
            if (ls.Values.TryGetValue(HostSessionIdKey, out var v) && v is string s && !string.IsNullOrWhiteSpace(s))
            {
                TryWriteHostSessionIdToFile(s);
                return s;
            }
            var id = Guid.NewGuid().ToString();
            ls.Values[HostSessionIdKey] = id;
            TryWriteHostSessionIdToFile(id);
            return id;
        }
        catch
        {
            var id = Guid.NewGuid().ToString();
            TryWriteHostSessionIdToFile(id);
            return id;
        }
    }

    private static string HostSessionIdFilePath()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver"
        );
        return Path.Combine(dir, "host_session_id.txt");
    }

    private static string? ReadHostSessionIdFromFile()
    {
        try
        {
            var path = HostSessionIdFilePath();
            if (!File.Exists(path)) return null;

            var id = (File.ReadAllText(path) ?? "").Trim();
            return string.IsNullOrWhiteSpace(id) ? null : id;
        }
        catch
        {
            return null;
        }
    }

    private static void TryWriteHostSessionIdToFile(string id)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(id)) return;
            var path = HostSessionIdFilePath();
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            File.WriteAllText(path, id.Trim());
        }
        catch
        {
        }
    }

}
