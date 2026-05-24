using System;
using System.Diagnostics;
using System.Windows;
using EMWaver.Services.Agent;

namespace EMWaver.Views;

public partial class AgentKeyWindow : Window
{
    private readonly AgentApiKeyStore _keyStore;
    private bool _savedKeyVisible;

    public AgentKeyWindow(AgentApiKeyStore keyStore)
    {
        InitializeComponent();
        _keyStore = keyStore;
        RefreshSavedKeyState();
    }

    private void RefreshSavedKeyState()
    {
        var existing = _keyStore.GetApiKey();
        var hasKey = !string.IsNullOrWhiteSpace(existing);
        SavedKeyPanel.Visibility = hasKey ? Visibility.Visible : Visibility.Collapsed;
        EnterKeyLabel.Text = hasKey ? "Replace key" : "Enter key";
        SavedKeyText.Text = hasKey ? (_savedKeyVisible ? existing! : MaskedKey(existing!)) : string.Empty;
        ViewSavedKeyButton.Content = _savedKeyVisible ? "Hide" : "View";
    }

    private static string MaskedKey(string key)
    {
        var trimmed = (key ?? string.Empty).Trim();
        if (trimmed.Length == 0) return "No key saved";
        if (trimmed.Length <= 10) return new string('•', Math.Max(trimmed.Length, 8));
        return trimmed[..Math.Min(6, trimmed.Length)] + "••••••••" + trimmed[^4..];
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

    private void OnViewSavedKeyClick(object sender, RoutedEventArgs e)
    {
        _savedKeyVisible = !_savedKeyVisible;
        RefreshSavedKeyState();
    }

    private void OnCopySavedKeyClick(object sender, RoutedEventArgs e)
    {
        var existing = _keyStore.GetApiKey();
        if (string.IsNullOrWhiteSpace(existing)) return;
        Clipboard.SetText(existing.Trim());
        CopySavedKeyButton.Content = "Copied";
    }

    private void OnRemoveSavedKeyClick(object sender, RoutedEventArgs e)
    {
        _keyStore.Clear();
        ApiKeyPasswordBox.Password = string.Empty;
        _savedKeyVisible = false;
        RefreshSavedKeyState();
    }

    private void OnMgptLinkClick(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("https://mdl.continualmi.com/mgpt-api") { UseShellExecute = true });
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
