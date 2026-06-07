namespace EMWaver.Models;

using System.IO;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled,
    bool ShadowsBundled
)
{
    public string FileName => Path.GetFileName(FullPath);

    public string DisplayName => Name;

    public string FilePath => FullPath;

    public string KindLabel
    {
        get
        {
            if (IsBundled && (Name.Equals("emw-kernel", System.StringComparison.OrdinalIgnoreCase) || Name.Equals("emw-protocol", System.StringComparison.OrdinalIgnoreCase))) return "Kernel";
            if (IsBundled && Name.StartsWith("emw-", System.StringComparison.OrdinalIgnoreCase)) return "Library";
            if (IsBundled) return "Example";
            if (ShadowsBundled) return "Override";
            return "Custom";
        }
    }

    public string SectionTitle => KindLabel switch
    {
        "Example" => "Examples",
        "Library" => "Libraries",
        "Kernel" => "Kernel",
        "Override" => "Custom Scripts",
        _ => "Custom Scripts",
    };

    public int KindSortRank
    {
        get
        {
            return KindLabel switch
            {
                "Example" => 0,
                "Library" => 1,
                "Kernel" => 2,
                "Override" => 3,
                _ => 3,
            };
        }
    }

    public string KindDetail
    {
        get
        {
            if (IsBundled) return "Bundled · read-only";
            if (ShadowsBundled) return "Local editable override";
            return "Local editable script";
        }
    }
}
