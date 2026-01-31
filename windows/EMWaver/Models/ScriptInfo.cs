namespace EMWaver.Models;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled
)
{
    public string FileName => Name + ".emw";
    public string KindLabel => IsBundled ? "Example script (read-only)" : "Custom script";
}
