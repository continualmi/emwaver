using EMWaver.Interop;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Linq;
using System.Threading.Tasks;

namespace EMWaver;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        // Dark-mode only (Windows app).
        RootGrid.RequestedTheme = ElementTheme.Dark;

        AppServices.Device.AttachUiDispatcher(DispatcherQueue.GetForCurrentThread());
        AppServices.Device.PropertyChanged += OnDevicePropertyChanged;

        AppServices.Device.AvailablePorts.CollectionChanged += OnPortsCollectionChanged;

        ContentFrame.Navigate(typeof(Pages.ScriptsPage));
        _ = BootstrapAsync();

        // Initial UI state.
        RunOnUi(() =>
        {
            UpdateDeviceStatus();
            RebuildConnectMenu();
        });
    }

    private void RunOnUi(Action action)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            action();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(() => action());
    }

    private void OnPortsCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        RunOnUi(RebuildConnectMenu);
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
        RebuildConnectMenu();
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // Device manager can raise PropertyChanged off-UI-thread.
        RunOnUi(() =>
        {
            UpdateDeviceStatus();

            if (e.PropertyName == nameof(AppServices.Device.AutoConnectEnabled)
                || e.PropertyName == nameof(AppServices.Device.ConnectedPort)
                || e.PropertyName == nameof(AppServices.Device.IsConnected))
            {
                RebuildConnectMenu();
            }
        });
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

        if (device.IsConnected && NativeBufferRust.IsAvailable)
        {
            var rx = NativeBufferRust.GetRxPacketCount();
            var tx = NativeBufferRust.GetTxPacketCount();
            DeviceBufferText.Text = $"RX {rx} TX {tx}";
        }
        else
        {
            DeviceBufferText.Text = string.Empty;
        }

        AutoConnectMenuItem.IsChecked = device.AutoConnectEnabled;
        UpdateModeStatusItem.Text = device.DfuConnected ? "Update Mode: Detected" : "Update Mode: Not detected";

        if (!string.IsNullOrWhiteSpace(device.LastErrorText))
        {
            LastErrorMenuItem.Text = device.LastErrorText;
            LastErrorMenuItem.Visibility = Visibility.Visible;
        }
        else
        {
            LastErrorMenuItem.Text = string.Empty;
            LastErrorMenuItem.Visibility = Visibility.Collapsed;
        }
    }

    private void RebuildConnectMenu()
    {
        ConnectSubmenu.Items.Clear();

        var ports = AppServices.Device.AvailablePorts.ToList();
        if (ports.Count == 0)
        {
            var item = new MenuFlyoutItem { Text = "No ports", IsEnabled = false };
            ConnectSubmenu.Items.Add(item);
            return;
        }

        foreach (var p in ports)
        {
            var isCurrent = AppServices.Device.IsConnected
                && AppServices.Device.ConnectedPort?.DisplayName == p.DisplayName;

            var item = new MenuFlyoutItem { Text = p.DisplayName };
            if (isCurrent)
            {
                item.Icon = new SymbolIcon(Symbol.Accept);
            }

            item.Click += async (_, __) =>
            {
                await AppServices.Device.ConnectAsync(p);
                UpdateDeviceStatus();
                RebuildConnectMenu();
            };

            ConnectSubmenu.Items.Add(item);
        }
    }

    private async void OnRefreshPortsClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshPortsAsync();
        RunOnUi(RebuildConnectMenu);
    }

    private void OnAutoConnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.AutoConnectEnabled = AutoConnectMenuItem.IsChecked;
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
