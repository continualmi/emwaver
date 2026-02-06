using EMWaver.Services.Cloud;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

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
        Microsoft.UI.Color OnlineColor);

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
        StatusText.Text = "Loading…";
        HostsList.ItemsSource = null;

        try
        {
            // Require auth (same as file sync). Allow empty token in dev when backend auth disabled.
            var allowAnon = (Environment.GetEnvironmentVariable("EMWAVER_ALLOW_ANON_SYNC") ?? "") == "1";
            var tok = AppServices.CloudAuth.GetIdToken();
            if (string.IsNullOrWhiteSpace(tok) && !allowAnon)
            {
                StatusText.Text = "Please sign in to view hosts.";
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
                OnlineColor: h.Online ? Colors.LimeGreen : Colors.Gray
            )).ToList();

            HostsList.ItemsSource = list;
            StatusText.Text = list.Count == 0 ? "No host sessions detected" : "";
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
        }
    }

    private void OnControlClick(object sender, RoutedEventArgs e)
    {
        try
        {
            if (sender is not Button b) return;
            var hostId = b.Tag as string ?? "";
            if (string.IsNullOrWhiteSpace(hostId)) return;

            Frame.Navigate(typeof(RemoteHostControlPage), hostId);
        }
        catch
        {
        }
    }
}
