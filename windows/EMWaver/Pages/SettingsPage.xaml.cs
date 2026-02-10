using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;
using EMWaver.Services.Cloud;

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
            FrontendUrlText.Text = FrontendUrl.Resolve();

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

            var frontendProd = AppServices.Settings.UseProductionFrontend;
            var frontendDesiredTag = frontendProd ? "prod" : "local";
            foreach (var item in FrontendModeCombo.Items)
            {
                if (item is ComboBoxItem cbi && (cbi.Tag as string) == frontendDesiredTag)
                {
                    FrontendModeCombo.SelectedItem = cbi;
                    break;
                }
            }
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
            var url = AppServices.CloudAuth.BuildSigninUrl();
            await Windows.System.Launcher.LaunchUriAsync(url);
            RefreshUi("Complete sign-in in browser, then paste the one-time handoff code and press Continue.");
        }
        catch (Exception ex)
        {
            RefreshUi(ex.Message);
        }
    }

    private async void OnConsumeHandoffClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var code = (HandoffCodeBox.Text ?? "").Trim();
            var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            await AppServices.CloudAuth.SignInWithHandoffCodeAsync(code, cts.Token);
            HandoffCodeBox.Text = string.Empty;
            RefreshUi("Signed in.");
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

    private void OnFrontendModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (FrontendModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var tag = (item.Tag as string) ?? "prod";
        var useProd = tag != "local";

        AppServices.Settings.UseProductionFrontend = useProd;
        RefreshUi("Frontend updated.");
    }
}
