namespace EMWaver.Models;

public sealed class ScriptSessionRegistry
{
    private readonly Dictionary<string, ScriptSessionInfo> _sessionsById = new(StringComparer.OrdinalIgnoreCase);
    private string? _selectedSessionId;

    public ScriptSessionInfo Start(
        string scriptName,
        string deviceLabel,
        string deviceId = "active",
        string? instanceId = null,
        Action? stopAction = null)
    {
        var id = string.IsNullOrWhiteSpace(instanceId) ? Guid.NewGuid().ToString() : instanceId.Trim();
        var session = new ScriptSessionInfo(
            InstanceId: id,
            DeviceId: string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim(),
            ScriptName: scriptName,
            DeviceLabel: string.IsNullOrWhiteSpace(deviceLabel) ? "active device" : deviceLabel,
            StateText: "running",
            StopAction: stopAction ?? (() => { })
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
        if (_sessionsById.Remove(id, out var removed))
        {
            removed.Stop();
        }
        if (!string.Equals(_selectedSessionId, id, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        _selectedSessionId = _sessionsById.Keys.LastOrDefault();
    }

    public void StopSelected() => Stop(_selectedSessionId);

    public void Clear()
    {
        foreach (var session in _sessionsById.Values)
        {
            session.Stop();
        }
        _sessionsById.Clear();
        _selectedSessionId = null;
    }

    public bool HasSessions => _sessionsById.Count > 0;

    public ScriptSessionInfo? SelectedSession =>
        _selectedSessionId is null ? null : _sessionsById.GetValueOrDefault(_selectedSessionId);

    public IReadOnlyList<ScriptSessionInfo> Sessions => _sessionsById.Values.ToList();
}
