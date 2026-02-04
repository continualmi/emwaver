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

            var mode = AppServices.Settings.EditorMode;
            var tag = mode switch
            {
                Services.EditorMode.Simple => "simple",
                _ => "code",
            };

            foreach (var item in EditorModeCombo.Items)
            {
                if (item is ComboBoxItem cbi && (cbi.Tag as string) == tag)
                {
                    EditorModeCombo.SelectedItem = cbi;
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

    private void OnEditorModeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (EditorModeCombo.SelectedItem is not ComboBoxItem item)
        {
            return;
        }

        var tag = item.Tag as string;
        var mode = tag switch
        {
            "simple" => Services.EditorMode.Simple,
            _ => Services.EditorMode.Code,
        };

        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Settings] EditorMode => {tag}");
        AppServices.Settings.EditorMode = mode;
        System.Diagnostics.Debug.WriteLine($"[EMWaver][Windows][Settings] EditorMode persisted => {AppServices.Settings.EditorMode}");
        RefreshUi("Editor setting updated.");
    }
}
