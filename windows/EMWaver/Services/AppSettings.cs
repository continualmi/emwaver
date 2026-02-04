using System;
using Windows.Storage;

namespace EMWaver.Services;

internal sealed class AppSettings
{
    private const string KeyUseMonaco = "UseMonacoEditor";

    public event Action? Changed;

    public bool UseMonacoEditor
    {
        get
        {
            try
            {
                var ls = ApplicationData.Current.LocalSettings;
                if (ls.Values.TryGetValue(KeyUseMonaco, out var v) && v is bool b)
                {
                    return b;
                }

                // Default ON: Monaco is preferred, but the user can switch back to the simple editor.
                return true;
            }
            catch
            {
                // If LocalSettings is unavailable for any reason (rare WinRT init issues),
                // fail safe to the simple editor.
                return false;
            }
        }
        set
        {
            try
            {
                var ls = ApplicationData.Current.LocalSettings;
                ls.Values[KeyUseMonaco] = value;
            }
            catch
            {
                // Ignore write failures; caller can still proceed.
            }
            Changed?.Invoke();
        }
    }
}
