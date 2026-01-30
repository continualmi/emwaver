namespace EMWaver.Models;

public sealed record ScriptInfo(
    string Name,
    string FullPath,
    bool IsBundled
);
