using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;

namespace EMWaver.Pages;

public sealed partial class SettingsPage : Page
{
    public SettingsPage()
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
        void Apply()
        {
            var signedIn = AppServices.CloudAuth.IsSignedIn;
            AuthStatusText.Text = signedIn ? "Signed in" : "Signed out";
            AuthDetailText.Text = message ?? string.Empty;

            SignInButton.IsEnabled = !signedIn;
            SignOutButton.IsEnabled = signedIn;

            BackendUrlText.Text = AppServices.CloudConfig.BackendBaseUrl;

            // Backend mode
            var prod = AppServices.Settings.UseProductionBackend;
            var desiredTag = prod ? "prod" : "local";
            foreach (var item in BackendModeCombo.Items)
            {
                if (item is ComboBoxItem cbi && (cbi.Tag as string) == desiredTag)
                {
                    BackendModeCombo.SelectedItem = cbi;
                    break;
                }
            }

            LocalBackendUrlBox.Text = AppServices.Settings.LocalBackendUrl;
            LocalBackendUrlBox.IsEnabled = !prod;
        }

        // UI updates must happen on the UI thread.
        if (DispatcherQueue.HasThreadAccess)
        {
            Apply();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(Apply);
    }

    private async void OnSignInClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            await AppServices.CloudAuth.SignInInteractiveAsync(cts.Token);
            RefreshUi("OK");
        }
        catch (Exception ex)
        {
            RefreshUi(ex.Message);
        }
    }

    private void OnSignOutClick(object sender, RoutedEventArgs e)
    {
        AppServices.CloudAuth.SignOut();
        RefreshUi("Signed out.");
    }

    private void OnBackendModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (BackendModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var tag = (item.Tag as string) ?? "prod";
        var useProd = tag != "local";

        AppServices.Settings.UseProductionBackend = useProd;
        LocalBackendUrlBox.IsEnabled = !useProd;

        // Backend change: sign out + restart cloud stack.
        AppServices.CloudAuth.SignOut();
        AppServices.ReloadCloud();

        RefreshUi("Backend updated.");
    }

    private void OnLocalBackendUrlChanged(object sender, TextChangedEventArgs e)
    {
        var v = (LocalBackendUrlBox.Text ?? "").Trim();
        AppServices.Settings.LocalBackendUrl = v;

        // If currently in local mode, restart cloud stack so new URL is used.
        if (!AppServices.Settings.UseProductionBackend)
        {
            AppServices.CloudAuth.SignOut();
            AppServices.ReloadCloud();
        }

        RefreshUi("Local backend URL updated.");
    }
}
