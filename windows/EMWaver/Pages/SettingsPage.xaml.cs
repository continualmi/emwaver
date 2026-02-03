using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

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
        var signedIn = AppServices.CloudAuth.IsSignedIn;
        AuthStatusText.Text = signedIn ? "Signed in" : "Signed out";
        AuthDetailText.Text = message ?? string.Empty;

        SignInButton.IsEnabled = !signedIn;
        SignOutButton.IsEnabled = signedIn;

        BackendUrlText.Text = AppServices.CloudConfig.BackendBaseUrl;
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

    private async void OnCloudTestClick(object sender, RoutedEventArgs e)
    {
        CloudResultText.Text = "Running...";
        try
        {
            var cts = new CancellationTokenSource(TimeSpan.FromMinutes(3));

            // Ensure signed-in
            _ = await AppServices.CloudAuth.EnsureSignedInAsync(cts.Token);

            // Upload a tiny file
            var name = "hello_cloud.emw";
            var content = "// cloud smoke test\n" +
                         "export default async function(ctx) {\n" +
                         "  ui.text({ text: 'cloud ok' })\n" +
                         "}\n";
            var bytes = Encoding.UTF8.GetBytes(content);

            var init = await AppServices.CloudFiles.InitUploadAsync(
                name: name,
                kind: "file",
                contentType: "text/plain",
                sizeBytes: bytes.Length,
                ct: cts.Token
            );

            await AppServices.CloudFiles.UploadBytesToSasAsync(init.UploadUrl, bytes, "text/plain", cts.Token);
            await AppServices.CloudFiles.CommitUploadAsync(init.File.Metadata.Id, init.File.Metadata.Etag, bytes.Length, cts.Token);

            var files = await AppServices.CloudFiles.ListAsync(kind: null, ext: null, ct: cts.Token);
            CloudResultText.Text = $"Uploaded {name}. Files now: {files.Count}";
        }
        catch (Exception ex)
        {
            CloudResultText.Text = "Failed: " + ex.Message;
        }
    }
}
