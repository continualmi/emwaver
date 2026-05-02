using EMWaver;
using EMWaver.Services.Cloud;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;

namespace EMWaver.Dialogs;

public sealed partial class AccountDialog : ContentDialog
{
    public AccountDialog()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        RefreshUi();
    }

    private void RefreshUi(string? message = null)
    {
        var signedIn = AppServices.CloudAuth.IsSignedIn;
        AuthStatusText.Text = signedIn ? "Key saved" : "No key saved";
        AuthDetailText.Text = message ?? (signedIn
            ? "An Agent key is saved. Paste a replacement any time."
            : "Agent replies require an API key. Local scripts and hardware control do not require a key.");

        SaveButton.Content = signedIn ? "Replace Key" : "Save Key";
        SignOutButton.Visibility = signedIn ? Visibility.Visible : Visibility.Collapsed;
        SignOutButton.IsEnabled = signedIn;
    }

    private async void OnManageOnWebClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var cts = new CancellationTokenSource(TimeSpan.FromMinutes(1));
            await AppServices.CloudAuth.OpenAccountManagementAsync(cts.Token);
            RefreshUi("The EMWaver account page opened in your browser.");
        }
        catch (Exception ex)
        {
            RefreshUi(ex.Message);
        }
    }

    private async void OnSaveKeyClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var apiKey = (ApiKeyBox.Password ?? string.Empty).Trim();
            var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            await AppServices.CloudAuth.SaveApiKeyAsync(apiKey, cts.Token);
            ApiKeyBox.Password = string.Empty;
            AppServices.AccountDevices.Refresh();
            RefreshUi("Saved the EMWaver API key.");
        }
        catch (Exception ex)
        {
            RefreshUi(ex.Message);
        }
    }

    private void OnSignOutClick(object sender, RoutedEventArgs e)
    {
        AppServices.CloudAuth.SignOut();
        AppServices.AccountDevices.Refresh();
        ApiKeyBox.Password = string.Empty;
        RefreshUi("Removed the Agent key.");
    }
}
