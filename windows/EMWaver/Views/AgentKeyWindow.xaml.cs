using System.Windows;
using EMWaver.Services.Agent;

namespace EMWaver.Views;

public partial class AgentKeyWindow : Window
{
    private readonly AgentApiKeyStore _keyStore;

    public AgentKeyWindow(AgentApiKeyStore keyStore)
    {
        InitializeComponent();
        _keyStore = keyStore;

        // Pre-fill if there's an existing key
        var existing = _keyStore.GetApiKey();
        if (!string.IsNullOrWhiteSpace(existing))
        {
            ApiKeyPasswordBox.Password = existing;
        }
    }

    private void OnSaveClick(object sender, RoutedEventArgs e)
    {
        var key = ApiKeyPasswordBox.Password.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            StatusText.Text = "API key cannot be empty.";
            StatusText.Visibility = Visibility.Visible;
            return;
        }

        _keyStore.SetApiKey(key);
        DialogResult = true;
        Close();
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
