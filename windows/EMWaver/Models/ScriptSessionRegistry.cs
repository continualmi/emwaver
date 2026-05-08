namespace EMWaver.Models;

public sealed class ScriptSessionRegistry
{
    private readonly Dictionary<string, ScriptSessionInfo> _sessionsById = new(StringComparer.OrdinalIgnoreCase);
    private string? _selectedSessionId;

    public ScriptSessionInfo Start(string scriptName, string deviceLabel, string? instanceId = null)
    {
        var id = string.IsNullOrWhiteSpace(instanceId) ? Guid.NewGuid().ToString() : instanceId.Trim();
        var session = new ScriptSessionInfo(
            InstanceId: id,
            ScriptName: scriptName,
            DeviceLabel: string.IsNullOrWhiteSpace(deviceLabel) ? "active device" : deviceLabel,
            StateText: "running"
        );
        _sessionsById[id] = session;
        _selectedSessionId = id;
        return session;
    }

    public void Stop(string? instanceId)
    {
        if (string.IsNullOrWhiteSpace(instanceId))
        {
            return;
        }

        var id = instanceId.Trim();
        _sessionsById.Remove(id);
        if (!string.Equals(_selectedSessionId, id, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _selectedSessionId = _sessionsById.Keys.LastOrDefault();
    }

    public void StopSelected() => Stop(_selectedSessionId);

    public void Clear()
    {
        _sessionsById.Clear();
        _selectedSessionId = null;
    }

    public bool HasSessions => _sessionsById.Count > 0;

    public ScriptSessionInfo? SelectedSession =>
        _selectedSessionId is null ? null : _sessionsById.GetValueOrDefault(_selectedSessionId);

    public IReadOnlyList<ScriptSessionInfo> Sessions => _sessionsById.Values.ToList();
}
