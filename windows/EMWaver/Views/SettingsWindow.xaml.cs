using System.Diagnostics;
using System.Windows;
using EMWaver;
using EMWaver.ViewModels;

namespace EMWaver.Views;

public partial class SettingsWindow : Window
{
    private readonly SettingsViewModel _viewModel;

    public SettingsWindow(SettingsViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
        _viewModel.DoneRequested += () => Close();
    }

    private void OnDoneClick(object sender, RoutedEventArgs e) => Close();

    private void OnMgptLinkClick(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("https://mdl.continualmi.com/mgpt-api") { UseShellExecute = true });
    }

    private void OnCheckForUpdatesClick(object sender, RoutedEventArgs e)
    {
        var window = new AppUpdateWindow(AppServices.AppUpdates)
        {
            Owner = this,
        };
        window.ShowDialog();
    }
}
