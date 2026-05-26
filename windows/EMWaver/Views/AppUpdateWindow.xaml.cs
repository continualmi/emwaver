using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using EMWaver.Services;

namespace EMWaver.Views;

public partial class AppUpdateWindow : Window
{
    private readonly AppUpdateService _updates;
    private readonly CancellationTokenSource _cts = new();
    private AppUpdateCheckResult? _result;

    internal AppUpdateWindow(AppUpdateService updates)
    {
        InitializeComponent();
        _updates = updates;
        VersionText.Text = $"Installed: {AppBuildInfo.ShortVersion}";
        DetailsText.Text = $"Updates are checked from {AppUpdateService.PrimaryManifestUri.Host}. Installers are downloaded from the release URL in the update manifest.";
    }

    private async void OnCheckClick(object sender, RoutedEventArgs e)
    {
        await CheckAsync();
    }

    private async void OnInstallClick(object sender, RoutedEventArgs e)
    {
        if (_result?.Manifest is not { } manifest) return;

        SetBusy("Downloading update installer...");
        DownloadProgress.Value = 0;
        DownloadProgress.Visibility = Visibility.Visible;

        try
        {
            var progress = new Progress<double>(value => DownloadProgress.Value = value);
            var installerPath = await _updates.DownloadInstallerAsync(manifest, progress, _cts.Token);
            StatusText.Text = "Starting installer. EMWaver may close while the update is installed.";
            _updates.LaunchInstaller(installerPath);
            Close();
        }
        catch (OperationCanceledException)
        {
            StatusText.Text = "Update download canceled.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Update install failed.";
            DetailsText.Text = ex.Message;
        }
        finally
        {
            ClearBusy();
        }
    }

    private void OnNotesClick(object sender, RoutedEventArgs e)
    {
        var notes = _result?.Manifest.Notes;
        if (string.IsNullOrWhiteSpace(notes)) return;
        Process.Start(new ProcessStartInfo(notes) { UseShellExecute = true });
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        _cts.Cancel();
        Close();
    }

    private async Task CheckAsync()
    {
        SetBusy("Checking for updates...");
        try
        {
            _result = await _updates.CheckForUpdatesAsync(_cts.Token);
            var manifest = _result.Manifest;
            VersionText.Text = $"Installed: {_result.CurrentVersion}  |  Latest: {manifest.Version}";

            if (_result.IsUpdateAvailable)
            {
                StatusText.Text = "A newer EMWaver desktop app is available.";
                InstallButton.IsEnabled = true;
            }
            else
            {
                StatusText.Text = "EMWaver is up to date.";
                InstallButton.IsEnabled = false;
            }

            DetailsText.Text = manifest.PublishedAt is { Length: > 0 }
                ? $"Published: {manifest.PublishedAt}"
                : "The update manifest was loaded successfully.";
            NotesButton.IsEnabled = !string.IsNullOrWhiteSpace(manifest.Notes);
        }
        catch (OperationCanceledException)
        {
            StatusText.Text = "Update check canceled.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Could not check for updates.";
            DetailsText.Text = ex.InnerException?.Message ?? ex.Message;
            InstallButton.IsEnabled = false;
            NotesButton.IsEnabled = false;
        }
        finally
        {
            ClearBusy();
        }
    }

    private void SetBusy(string message)
    {
        StatusText.Text = message;
        CheckButton.IsEnabled = false;
        InstallButton.IsEnabled = false;
    }

    private void ClearBusy()
    {
        CheckButton.IsEnabled = true;
        InstallButton.IsEnabled = _result?.IsUpdateAvailable == true;
    }
}
