namespace EMWaver;

public sealed partial class MainWindow
{
    private void OnScriptsPreviewModeChanged(bool preview)
    {
        SetScriptModeUi(preview);
    }
}
