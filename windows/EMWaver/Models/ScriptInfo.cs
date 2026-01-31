namespace EMWaver.Models;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled,
    bool ShadowsBundled
)
{
    public string FileName => Name + ".emw";

    public string KindLabel
    {
        get
        {
            if (IsBundled) return "Read-only";
            if (ShadowsBundled) return "Overrides read-only";
            return string.Empty;
        }
    }
}
