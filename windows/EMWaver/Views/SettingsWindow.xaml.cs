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

    private void OnCheckForUpdatesClick(object sender, RoutedEventArgs e)
    {
        var window = new AppUpdateWindow(AppServices.AppUpdates)
        {
            Owner = this,
        };
        window.ShowDialog();
    }

    private void OnResetMcpTokenClick(object sender, RoutedEventArgs e)
    {
        _viewModel.ResetMcpServerToken();
    }
}
