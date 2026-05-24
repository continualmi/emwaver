using System.Windows;
using System.Windows.Media;

namespace EMWaver.Services;

internal static class ThemeResources
{
    /// <summary>
    /// Looks up a theme-aware brush by key from the current application resources.
    /// Falls back to a solid color brush using the provided fallback color.
    /// </summary>
    public static Brush Brush(string key, Color fallbackColor)
    {
        try
        {
            var resources = Application.Current?.Resources;
            if (resources != null && resources.Contains(key) && resources[key] is Brush brush)
            {
                return brush;
            }
        }
        catch
        {
        }

        return new SolidColorBrush(fallbackColor);
    }
}
