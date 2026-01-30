using EMWaver.Pages;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;

namespace EMWaver;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        AppServices.Device.AttachUiDispatcher(DispatcherQueue.GetForCurrentThread());
        AppServices.Device.PropertyChanged += OnDevicePropertyChanged;

        AutoConnectToggle.IsChecked = AppServices.Device.AutoConnectEnabled;

        ConnectFlyout.Opening += OnConnectFlyoutOpening;

        ContentFrame.Navigate(typeof(ScriptsPage));
        _ = BootstrapAsync();
    }

    private void OnConnectFlyoutOpening(object sender, object e)
    {
        // Rebuild each time so it stays in sync with refresh/connect.
        ConnectFlyout.Items.Clear();

        var ports = AppServices.Device.AvailablePorts.ToList();
        if (ports.Count == 0)
        {
            var item = new MenuFlyoutItem { Text = "No ports" };
            item.IsEnabled = false;
            ConnectFlyout.Items.Add(item);
            return;
        }

        foreach (var p in ports)
        {
            var isCurrent = AppServices.Device.IsConnected && AppServices.Device.ConnectedPort?.DisplayName == p.DisplayName;
            var item = new MenuFlyoutItem { Text = p.DisplayName };
            if (isCurrent)
            {
                item.Icon = new SymbolIcon(Symbol.Accept);
            }
            item.Click += async (_, __) =>
            {
                await AppServices.Device.ConnectAsync(p);
            };
            ConnectFlyout.Items.Add(item);
        }
    }

    private async Task BootstrapAsync()
    {
        try
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            await AppServices.Device.RefreshPortsAsync();
        }
        catch (Exception ex)
        {
            DeviceStatusText.Text = "Error";
            DeviceVersionText.Text = ex.Message;
        }

        UpdateDeviceStatus();
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Keep the top bar status fresh.
        UpdateDeviceStatus();
    }

    private void UpdateDeviceStatus()
    {
        var device = AppServices.Device;
        switch (device.Mode)
        {
            case Services.DeviceMode.RunMode:
                DeviceStatusText.Text = "Connected";
                break;
            case Services.DeviceMode.UpdateMode:
                DeviceStatusText.Text = "Update Mode";
                break;
            default:
                DeviceStatusText.Text = "Disconnected";
                break;
        }

        DeviceVersionText.Text = device.IsConnected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"EMWaver {device.DeviceEmwaverVersion}"
            : string.Empty;

        AutoConnectToggle.IsChecked = device.AutoConnectEnabled;
    }

    private void OnScriptsClick(object sender, RoutedEventArgs e)
    {
        ScriptsToggle.IsChecked = true;
        DeviceToggle.IsChecked = false;
        ContentFrame.Navigate(typeof(ScriptsPage));
    }

    private void OnDeviceClick(object sender, RoutedEventArgs e)
    {
        ScriptsToggle.IsChecked = false;
        DeviceToggle.IsChecked = true;
        ContentFrame.Navigate(typeof(DevicePage));
    }

    private async void OnRefreshPortsClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshPortsAsync();
    }

    private void OnAutoConnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.AutoConnectEnabled = AutoConnectToggle.IsChecked == true;
    }

    private void OnDisconnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.Disconnect();
    }

    private void OnEnterUpdateModeClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.RequestEnterUpdateMode();
        AppServices.Device.Disconnect();
        _ = AppServices.Device.RefreshDfuPresenceAsync();
    }

    private async void OnRefreshUpdateModeClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshDfuPresenceAsync();
    }
}
