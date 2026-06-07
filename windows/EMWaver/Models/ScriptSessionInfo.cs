namespace EMWaver.Models;

public sealed record ScriptSessionInfo(
    string InstanceId,
    string DeviceId,
    string ScriptName,
    string DeviceLabel,
    string StateText,
    Action StopAction
)
{
    public string FileName => ScriptName.EndsWith(".emw", System.StringComparison.OrdinalIgnoreCase)
        || ScriptName.EndsWith(".js", System.StringComparison.OrdinalIgnoreCase)
        ? ScriptName
        : ScriptName + ".emw";

    public string StatusLabel => $"{StateText} on {DeviceLabel}";

    public bool IsRunning => string.Equals(StateText, "running", System.StringComparison.OrdinalIgnoreCase);

    public void Stop() => StopAction();
}
