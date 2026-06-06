namespace EMWaver.Models;

public sealed record ScriptToolbarState(bool HasSelection, bool IsBundled, bool IsDirty)
{
    public bool CanRun => HasSelection;
    public bool CanPreview => HasSelection;
    public bool CanSave => HasSelection && !IsBundled && IsDirty;
    public bool CanCopy => HasSelection;
    public bool CanRename => HasSelection && !IsBundled;
    public bool CanDelete => HasSelection && !IsBundled;
    public bool CanRefresh => true;
}
