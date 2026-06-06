using System.Windows;
using EMWaver.Services;

namespace EMWaver;

public partial class App : Application
{
    public static App Instance => (App)Current;

    private void OnStartup(object sender, StartupEventArgs e)
    {
        EnvBootstrap.LoadForDevIfAvailable();
        ApplyTheme();
        AppServices.Settings.Changed += OnSettingsChanged;
        AppServices.McpServer.SyncWithSettings();

        var mainWindow = new MainWindow();
        mainWindow.Show();
    }

    private void OnSettingsChanged()
    {
        Dispatcher.Invoke(() =>
        {
            ApplyTheme();
            AppServices.McpServer.SyncWithSettings();
        });
    }

    internal void ApplyTheme()
    {
        // Windows intentionally ships a single stable light UI theme.
        Resources.MergedDictionaries.Clear();
        Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("Themes/Light.xaml", UriKind.Relative) });
    }

    protected override void OnExit(ExitEventArgs e)
    {
        AppServices.Settings.Changed -= OnSettingsChanged;
        AppServices.McpServer.Dispose();
        base.OnExit(e);
    }
}
