using Microsoft.UI.Xaml;

namespace EMWaver;

public sealed partial class MainWindow
{
    private void OnScriptsPreviewModeChanged(bool preview)
    {
        SetScriptMode(preview);
    }
}
