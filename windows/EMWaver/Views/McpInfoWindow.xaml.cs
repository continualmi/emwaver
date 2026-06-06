using System.Diagnostics;
using System.Windows;
using EMWaver.ViewModels;

namespace EMWaver.Views;

public partial class McpInfoWindow : Window
{
    private readonly SettingsViewModel _viewModel;

    public McpInfoWindow(SettingsViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        DataContext = viewModel;
    }

    private void OnCopyEndpointClick(object sender, RoutedEventArgs e)
    {
        Clipboard.SetText(_viewModel.McpEndpointUrl);
    }

    private void OnCopyTokenClick(object sender, RoutedEventArgs e)
    {
        Clipboard.SetText(_viewModel.McpServerToken);
    }

    private void OnResetTokenClick(object sender, RoutedEventArgs e)
    {
        _viewModel.ResetMcpServerToken();
    }

    private void OnEmwaverDocsClick(object sender, RoutedEventArgs e)
    {
        OpenUrl("https://emwaver.ai/docs/mcp");
    }

    private void OnOfficialDocsClick(object sender, RoutedEventArgs e)
    {
        OpenUrl("https://modelcontextprotocol.io/docs/getting-started/intro");
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
