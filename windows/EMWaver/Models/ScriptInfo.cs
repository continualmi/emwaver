namespace EMWaver.Models;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled,
    bool ShadowsBundled
)
{
    public string FileName => Name.EndsWith(".js", System.StringComparison.OrdinalIgnoreCase)
        ? Name
        : Name + ".js";

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
