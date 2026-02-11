using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Threading;
using EMWaver.Services.Cloud;

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
        AuthStatusText.Text = signedIn ? "Signed in" : "Signed out";
        AuthDetailText.Text = message ?? string.Empty;

        SignInButton.IsEnabled = !signedIn;
        SignOutButton.IsEnabled = signedIn;
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
            var code = (HandoffCodeBox.Text ?? string.Empty).Trim();
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
}
