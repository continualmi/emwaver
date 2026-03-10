using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace EMWaver.Services;

internal static class ThemeResources
{
    public static Brush Brush(string key, Color fallbackColor)
    {
        try
        {
            var resources = Application.Current?.Resources;
            if (resources != null)
            {
                var themeKey = ResolveThemeKey();
                if (resources.ThemeDictionaries.ContainsKey(themeKey) &&
                    resources.ThemeDictionaries[themeKey] is ResourceDictionary themeResources &&
                    themeResources.ContainsKey(key) &&
                    themeResources[key] is Brush themedBrush)
                {
                    return themedBrush;
                }

                if (resources.ThemeDictionaries.ContainsKey("Default") &&
                    resources.ThemeDictionaries["Default"] is ResourceDictionary defaultThemeResources &&
                    defaultThemeResources.ContainsKey(key) &&
                    defaultThemeResources[key] is Brush defaultBrush)
                {
                    return defaultBrush;
                }

                if (resources.ContainsKey(key) && resources[key] is Brush brush)
                {
                    return brush;
                }
            }
        }
        catch
        {
        }

        return new SolidColorBrush(fallbackColor);
    }

    private static string ResolveThemeKey()
    {
        try
        {
            var root = App.MainWindow?.Content as FrameworkElement;
            return root?.ActualTheme == ElementTheme.Dark ? "Dark" : "Light";
        }
        catch
        {
            return "Light";
        }
    }
}
