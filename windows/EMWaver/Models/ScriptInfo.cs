namespace EMWaver.Models;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled,
    bool ShadowsBundled
)
{
    public string FileName => Name + ".emw";

    public string KindLabel => IsBundled ? "Read-only" : string.Empty;
}
