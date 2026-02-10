using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;
using System.Threading.Tasks;
using EMWaver.Services.Cloud;
using Windows.System;

namespace EMWaver.Pages;

public sealed partial class SettingsPage : Page
{
    private bool _suppressModeSelectionEvents;

    public SettingsPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        RefreshUi();
        _ = RefreshProStatusAsync();
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

            _suppressModeSelectionEvents = true;
            try
            {
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
            finally
            {
                _suppressModeSelectionEvents = false;
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

    private async Task RefreshProStatusAsync()
    {
        try
        {
            var snap = await AppServices.Entitlements.RefreshAsync(force: true, CancellationToken.None);
            var text = "You’re not eligible to subscribe yet.";

            if (!AppServices.CloudAuth.IsSignedIn)
            {
                text = "To subscribe, sign in and attach a genuine EMWaver device to your account first.";
            }
            else if (snap.Entitlements?.Pro == true)
            {
                text = "EMWaver Pro is active.";
            }
            else if (snap.Eligibility?.CanPurchasePro == true)
            {
                text = "Eligible to subscribe.";
            }
            else if (string.Equals(snap.Eligibility?.Reason, "no_device", StringComparison.OrdinalIgnoreCase))
            {
                text = "To subscribe, connect and attach a genuine EMWaver device to your account first.";
            }

            if (!string.IsNullOrWhiteSpace(snap.LastError))
            {
                text = snap.LastError!;
            }

            if (DispatcherQueue.HasThreadAccess)
            {
                ProStatusText.Text = text;
            }
            else
            {
                _ = DispatcherQueue.TryEnqueue(() => ProStatusText.Text = text);
            }
        }
        catch (Exception ex)
        {
            if (DispatcherQueue.HasThreadAccess)
            {
                ProStatusText.Text = ex.Message;
            }
            else
            {
                _ = DispatcherQueue.TryEnqueue(() => ProStatusText.Text = ex.Message);
            }
        }
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
        if (_suppressModeSelectionEvents)
        {
            return;
        }

        if (BackendModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var tag = (item.Tag as string) ?? "prod";
        var useProd = tag != "local";

        if (AppServices.Settings.UseProductionBackend == useProd)
        {
            return;
        }

        AppServices.Settings.UseProductionBackend = useProd;

        // Backend change: sign out + restart cloud stack.
        AppServices.CloudAuth.SignOut();
        AppServices.ReloadCloud();

        RefreshUi("Backend updated.");
    }

    private void OnFrontendModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppressModeSelectionEvents)
        {
            return;
        }

        if (FrontendModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var tag = (item.Tag as string) ?? "prod";
        var useProd = tag != "local";

        if (AppServices.Settings.UseProductionFrontend == useProd)
        {
            return;
        }

        AppServices.Settings.UseProductionFrontend = useProd;
        RefreshUi("Frontend updated.");
    }

    private async void OnGetProClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var url = FrontendUrl.Resolve().TrimEnd('/') + "/pro";
            await Launcher.LaunchUriAsync(new Uri(url));
        }
        catch (Exception ex)
        {
            RefreshUi(ex.Message);
        }
    }

    private async void OnRefreshProClick(object sender, RoutedEventArgs e)
    {
        await RefreshProStatusAsync();
    }
}
