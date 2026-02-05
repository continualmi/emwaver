namespace EMWaver.Models;

public sealed record SignalFileInfo(
    string Name,
    string FullPath,
    string Extension
)
{
    public string FileName => Name + Extension;
}
