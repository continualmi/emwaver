using System.Windows;
using EMWaver.Services;

namespace EMWaver;

public partial class App : Application
{
    public static App Instance => (App)Current;

    private void OnStartup(object sender, StartupEventArgs e)
    {
        EnvBootstrap.LoadForDevIfAvailable();
        ApplyTheme(AppServices.Settings.Theme);
        AppServices.Settings.Changed += OnSettingsChanged;

        var mainWindow = new MainWindow();
        mainWindow.Show();
    }

    private void OnSettingsChanged()
    {
        Dispatcher.Invoke(() => ApplyTheme(AppServices.Settings.Theme));
    }

    internal void ApplyTheme(AppThemeMode theme)
    {
        // Clear existing theme dictionaries and reload.
        Resources.MergedDictionaries.Clear();
        var themePath = theme switch
        {
            AppThemeMode.Light => "Themes/Light.xaml",
            AppThemeMode.Dark => "Themes/Dark.xaml",
            _ => "Themes/Light.xaml",
        };

        var uri = new Uri(themePath, UriKind.Relative);
        Resources.MergedDictionaries.Add(new ResourceDictionary { Source = uri });
    }

    protected override void OnExit(ExitEventArgs e)
    {
        AppServices.Settings.Changed -= OnSettingsChanged;
        base.OnExit(e);
    }
}
