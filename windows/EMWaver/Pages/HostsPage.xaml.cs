using EMWaver.Services.Cloud;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Windows.System;

namespace EMWaver.Pages;

public sealed partial class HostsPage : Page
{
    private sealed record HostRow(
        string HostSessionId,
        string Title,
        string Subtitle,
        string UsbLabel,
        string PortLine,
        string ScriptLine,
        string IdLine,
        bool CanControl,
        Windows.UI.Color OnlineColor);

    private bool _proEnabled;
    private int _refreshVersion;

    public HostsPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        _ = RefreshAsync();
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        var refreshVersion = Interlocked.Increment(ref _refreshVersion);
        await RunOnUiThreadAsync(() =>
        {
            StatusText.Text = "Loading…";
            HostsList.ItemsSource = null;
        });

        try
        {
            var pro = await AppServices.Entitlements.RefreshAsync(force: true, CancellationToken.None);
            _proEnabled = pro.Entitlements?.FeatureFlags.CloudHosts ?? false;
            var signedIn = AppServices.CloudAuth.IsSignedIn;

            // Require auth (same as file sync). Allow empty token in dev when backend auth disabled.
            var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
            var tok = AppServices.CloudAuth.GetIdToken();
            if (string.IsNullOrWhiteSpace(tok) && !allowAnon)
            {
                await RunOnUiThreadAsync(() =>
                {
                    if (refreshVersion != _refreshVersion) return;
                    StatusText.Text = "Please sign in to view hosts.";
                });
                return;
            }

            var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var rows = await AppServices.CloudHosts.ListAsync(accessToken: allowAnon ? tok : tok, ct: cts.Token);

            var list = rows.Select(h => new HostRow(
                HostSessionId: h.Id,
                Title: !string.IsNullOrWhiteSpace(h.DeviceName) ? h.DeviceName : h.Id,
                Subtitle: string.Join(" · ", new[] { h.Platform, string.IsNullOrWhiteSpace(h.AppVersion) ? null : ("v" + h.AppVersion) }.Where(x => !string.IsNullOrWhiteSpace(x))),
                UsbLabel: h.UsbConnected ? "USB" : "No USB",
                PortLine: h.UsbConnected && !string.IsNullOrWhiteSpace(h.ConnectedPort) ? ("Port: " + h.ConnectedPort) : "",
                ScriptLine: h.ScriptRunning ? (string.IsNullOrWhiteSpace(h.ActiveScriptName) ? "Script running" : ("Running: " + h.ActiveScriptName)) : "",
                IdLine: "ID: " + h.Id,
                CanControl: _proEnabled,
                OnlineColor: h.Online ? Colors.LimeGreen : Colors.Gray
            )).ToList();

            await RunOnUiThreadAsync(() =>
            {
                if (refreshVersion != _refreshVersion) return;

                HostsList.ItemsSource = list;
                ProBanner.Visibility = _proEnabled ? Visibility.Collapsed : Visibility.Visible;
                GetProButton.Visibility = _proEnabled ? Visibility.Collapsed : Visibility.Visible;

                if (!_proEnabled)
                {
                    if (!signedIn)
                    {
                        StatusText.Text = "Sign in, then attach a genuine EMWaver device to your account to become eligible for Pro.";
                    }
                    else if (pro.Eligibility?.CanPurchasePro == true)
                    {
                        StatusText.Text = "Remote host control is locked. Upgrade to EMWaver Pro to control host sessions.";
                    }
                    else if (string.Equals(pro.Eligibility?.Reason, "no_device", StringComparison.OrdinalIgnoreCase))
                    {
                        StatusText.Text = "To subscribe, connect and attach a genuine EMWaver device to your account first.";
                    }
                    else
                    {
                        StatusText.Text = "You’re not eligible to subscribe yet.";
                    }
                }
                else
                {
                    StatusText.Text = list.Count == 0 ? "No host sessions detected" : "";
                }
            });
        }
        catch (Exception ex)
        {
            await RunOnUiThreadAsync(() =>
            {
                if (refreshVersion != _refreshVersion) return;
                StatusText.Text = ex.Message;
            });
        }
    }

    private Task RunOnUiThreadAsync(Action action)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            action();
            return Task.CompletedTask;
        }

        var tcs = new TaskCompletionSource<object?>();
        if (!DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, () =>
        {
            try
            {
                action();
                tcs.TrySetResult(null);
            }
            catch (Exception ex)
            {
                tcs.TrySetException(ex);
            }
        }))
        {
            tcs.TrySetException(new InvalidOperationException("Unable to access UI dispatcher."));
        }

        return tcs.Task;
    }

    private void OnControlClick(object sender, RoutedEventArgs e)
    {
        try
        {
            if (sender is not Button b) return;
            var hostId = b.Tag as string ?? "";
            if (string.IsNullOrWhiteSpace(hostId)) return;

            if (!_proEnabled)
            {
                StatusText.Text = "Remote host control is locked. Upgrade to EMWaver Pro to control host sessions.";
                return;
            }

            Frame.Navigate(typeof(RemoteHostControlPage), hostId);
        }
        catch
        {
        }
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
            StatusText.Text = ex.Message;
        }
    }

    private void OnBackClick(object sender, RoutedEventArgs e)
    {
        if (Frame?.CanGoBack == true)
        {
            Frame.GoBack();
            return;
        }

        Frame?.Navigate(typeof(ScriptsPage));
    }
}
