using EMWaver.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.ComponentModel;
using System.Threading.Tasks;

namespace EMWaver.Pages;

public sealed partial class DevicePage : Page
{
    public DevicePage()
    {
        InitializeComponent();

        // Device manager can raise PropertyChanged off-UI-thread; always marshal UI work.
        AppServices.Device.AttachUiDispatcher(this.DispatcherQueue);

        PortsList.ItemsSource = AppServices.Device.AvailablePorts;
        AutoConnectSwitch.IsOn = AppServices.Device.AutoConnectEnabled;

        AppServices.Device.PropertyChanged += OnDevicePropertyChanged;
        Unloaded += OnUnloaded;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await AppServices.Device.RefreshPortsAsync();
        if (DispatcherQueue.HasThreadAccess)
        {
            UpdateUi();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(UpdateUi);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        AppServices.Device.PropertyChanged -= OnDevicePropertyChanged;
        Unloaded -= OnUnloaded;
    }

    private void OnDevicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (DispatcherQueue.HasThreadAccess)
        {
            UpdateUi();
            return;
        }

        _ = DispatcherQueue.TryEnqueue(UpdateUi);
    }

    private void UpdateUi()
    {
        var device = AppServices.Device;
        AutoConnectSwitch.IsOn = device.AutoConnectEnabled;

        switch (device.Mode)
        {
            case Services.DeviceMode.RunMode:
                StatusText.Text = "Connected";
                break;
            case Services.DeviceMode.UpdateMode:
                StatusText.Text = "Update Mode";
                break;
            default:
                StatusText.Text = "Disconnected";
                break;
        }

        VersionText.Text = device.IsConnected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"EMWaver {device.DeviceEmwaverVersion}"
            : string.Empty;

        DfuText.Text = device.DfuConnected ? "Update Mode: Detected" : "Update Mode: Not detected";
        ErrorText.Text = device.LastErrorText ?? string.Empty;
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshPortsAsync();
    }

    private void OnAutoConnectToggled(object sender, RoutedEventArgs e)
    {
        AppServices.Device.AutoConnectEnabled = AutoConnectSwitch.IsOn;
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

    private async void OnConnectClick(object sender, RoutedEventArgs e)
    {
        if (PortsList.SelectedItem is not DevicePort port)
        {
            return;
        }

        await AppServices.Device.ConnectAsync(port);
        UpdateUi();
    }
}
