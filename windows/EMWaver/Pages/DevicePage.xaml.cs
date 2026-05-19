using EMWaver.Dialogs;
using EMWaver.Models;
using EMWaver.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.ComponentModel;

namespace EMWaver.Pages;

public sealed partial class DevicePage : Page
{
    public DevicePage()
    {
        InitializeComponent();

        AppServices.Device.AttachUiDispatcher(this.DispatcherQueue);
        AppServices.FirmwareUpdater.AttachUiDispatcher(this.DispatcherQueue);

        PortsList.ItemsSource = AppServices.Device.AvailablePorts;

        AppServices.Device.PropertyChanged += OnStateChanged;
        AppServices.FirmwareUpdater.PropertyChanged += OnStateChanged;

        Unloaded += OnUnloaded;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await AppServices.Device.RefreshPortsAsync();
        await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
        UpdateUi();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        AppServices.Device.PropertyChanged -= OnStateChanged;
        AppServices.FirmwareUpdater.PropertyChanged -= OnStateChanged;
        Unloaded -= OnUnloaded;
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
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
        var updater = AppServices.FirmwareUpdater;

        AutoConnectSwitch.IsOn = device.AutoConnectEnabled;
        DisconnectButton.IsEnabled = device.IsConnected;

        var boardType = device.ConnectedBoardType ?? device.LastDetectedBoardType ?? (updater.EspBootloaderConnected ? "esp32s3" : "stm32f042");
        var isEsp = string.Equals(boardType, "esp32s3", StringComparison.OrdinalIgnoreCase) || updater.EspBootloaderConnected;

        if (device.IsConnected)
        {
            StatusText.Text = "Connected";
        }
        else if (updater.EspBootloaderConnected)
        {
            StatusText.Text = "ESP Bootloader";
        }
        else if (updater.DfuConnected || device.DfuConnected)
        {
            StatusText.Text = "Update Mode";
        }
        else
        {
            StatusText.Text = "Disconnected";
        }

        VersionText.Text = device.IsConnected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"EMWaver {device.DeviceEmwaverVersion}"
            : string.Empty;
        BoardTypeText.Text = string.IsNullOrWhiteSpace(boardType) ? string.Empty : $"Board: {boardType}";
        HardwareUidText.Text = string.Empty;
        SecureText.Text = string.Empty;
        DeviceIdText.Text = string.Empty;
        AttachStatusText.Text = string.Empty;
        ClaimStatusText.Text = string.Empty;
        OfflineStatusText.Text = string.Empty;
        UpdateModeStatusText.Text = updater.EspBootloaderConnected
            ? $"ESP bootloader detected on {updater.EspBootloaderPort ?? "serial port"}."
            : ((updater.DfuConnected || device.DfuConnected) ? "STM32 Update Mode detected." : "Update Mode not detected.");
        VerificationText.Text = string.Empty;
        ErrorText.Text = updater.UpdateError ?? device.LastErrorText ?? string.Empty;

        FirmwareProgressBar.Value = updater.ProgressPct;
        FirmwareProgressText.Text = updater.IsFlashing
            ? $"{(string.IsNullOrWhiteSpace(updater.ProgressMessage) ? "Updating..." : updater.ProgressMessage)} ({(int)Math.Round(updater.ProgressPct)}%)"
            : (updater.UpdateDone ? updater.CompletionMessage : "Open the firmware action to set up or update this device.");
        FirmwareStatusText.Text = isEsp
            ? "ESP32-S3 uses serial flashing on the flash-capable USB port."
            : "STM32 uses the managed DFU update flow.";
        ActivityLogTextBox.Text = string.IsNullOrWhiteSpace(updater.LogText) ? "No activity yet." : updater.LogText;

        UpdateModeButton.Content = isEsp ? "Refresh bootloader" : "Enter Update Mode";
        UpdateModeButton.IsEnabled = !updater.IsFlashing && (isEsp || device.IsConnected);
        PrimaryFirmwareButton.Content = GetPrimaryFirmwareTitle(isEsp);
        PrimaryFirmwareButton.IsEnabled = !updater.IsFlashing && CanRunFirmwareAction(isEsp, device, updater);
        WiFiProvisionButton.IsEnabled = device.IsConnected
            && !device.IsWiFiProvisioning
            && !string.IsNullOrWhiteSpace(WiFiSsidBox.Text);
        WiFiClearButton.IsEnabled = device.IsConnected && !device.IsWiFiProvisioning;
        WiFiStatusButton.IsEnabled = device.IsConnected && !device.IsWiFiProvisioning;
        WiFiProvisionButton.Content = device.IsWiFiProvisioning ? "Provisioning" : "Send Wi-Fi Setup";
        WiFiProvisioningStatusText.Text = device.WiFiProvisioningStatus ?? string.Empty;

        DevicesIntroText.Text = "Local devices.";
    }

    private static string GetPrimaryFirmwareTitle(bool isEsp)
    {
        return isEsp ? "Flash firmware" : "Update firmware";
    }

    private static bool CanRunFirmwareAction(bool isEsp, WindowsDeviceManager device, FirmwareUpdateManager updater)
    {
        if (updater.IsFlashing) return false;
        if (isEsp)
        {
            var bootloaderReady = updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(updater.EspBootloaderPort);
            return bootloaderReady;
        }
        return device.IsConnected || updater.DfuConnected;
    }

    private async void OnRefreshClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshPortsAsync();
        UpdateUi();
    }

    private void OnAutoConnectToggled(object sender, RoutedEventArgs e)
    {
        AppServices.Device.AutoConnectEnabled = AutoConnectSwitch.IsOn;
    }

    private void OnDisconnectClick(object sender, RoutedEventArgs e)
    {
        AppServices.Device.Disconnect();
    }

    private async void OnEnterUpdateModeClick(object sender, RoutedEventArgs e)
    {
        var boardType = AppServices.Device.ConnectedBoardType ?? AppServices.Device.LastDetectedBoardType ?? "stm32f042";
        if (string.Equals(boardType, "esp32s3", StringComparison.OrdinalIgnoreCase) || AppServices.FirmwareUpdater.EspBootloaderConnected)
        {
            await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
        }
        else
        {
            AppServices.Device.RequestEnterUpdateMode();
            AppServices.Device.Disconnect();
            await AppServices.Device.RefreshDfuPresenceAsync();
            await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
        }

        UpdateUi();
    }

    private async void OnRefreshUpdateModeClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshDfuPresenceAsync();
        await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
        UpdateUi();
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

    private async void OnConnectWiFiClick(object sender, RoutedEventArgs e)
    {
        var host = WiFiHostBox.Text.Trim();
        var port = int.TryParse(WiFiPortBox.Text.Trim(), out var parsedPort) && WindowsWiFiTransport.IsValidPort(parsedPort)
            ? parsedPort
            : WindowsWiFiTransport.DefaultPort;
        await AppServices.Device.ConnectWiFiAsync(host, port);
        UpdateUi();
    }

    private async void OnProvisionWiFiClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.ProvisionWiFiAsync(WiFiSsidBox.Text, WiFiPasswordBox.Password);
        UpdateUi();
    }

    private async void OnClearWiFiClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.ClearWiFiProvisioningAsync();
        UpdateUi();
    }

    private async void OnWiFiStatusClick(object sender, RoutedEventArgs e)
    {
        await AppServices.Device.RefreshWiFiProvisioningStatusAsync();
        UpdateUi();
    }

    private async void OnPrimaryFirmwareClick(object sender, RoutedEventArgs e)
    {
        var dialog = new FirmwareUpdateDialog(AppServices.Device, AppServices.FirmwareUpdater)
        {
            XamlRoot = this.XamlRoot,
        };

        dialog.SetPresentedBoardType(AppServices.Device.ConnectedBoardType ?? AppServices.Device.LastDetectedBoardType);
        await dialog.ShowAsync();
        UpdateUi();
    }
}
