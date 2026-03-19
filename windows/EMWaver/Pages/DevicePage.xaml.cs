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
        AppServices.AccountDevices.AttachUiDispatcher(this.DispatcherQueue);

        PortsList.ItemsSource = AppServices.Device.AvailablePorts;
        DevicesList.ItemsSource = AppServices.AccountDevices.Devices;

        AppServices.Device.PropertyChanged += OnStateChanged;
        AppServices.FirmwareUpdater.PropertyChanged += OnStateChanged;
        AppServices.AccountDevices.PropertyChanged += OnStateChanged;
        AppServices.CloudAuth.Changed += OnAuthChanged;

        Unloaded += OnUnloaded;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await AppServices.Device.RefreshPortsAsync();
        await AppServices.FirmwareUpdater.RefreshDfuPresenceAsync();
        AppServices.AccountDevices.Refresh();
        UpdateUi();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        AppServices.Device.PropertyChanged -= OnStateChanged;
        AppServices.FirmwareUpdater.PropertyChanged -= OnStateChanged;
        AppServices.AccountDevices.PropertyChanged -= OnStateChanged;
        AppServices.CloudAuth.Changed -= OnAuthChanged;
        Unloaded -= OnUnloaded;
    }

    private void OnAuthChanged()
    {
        _ = DispatcherQueue.TryEnqueue(UpdateUi);
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
        var accountDevices = AppServices.AccountDevices;

        AutoConnectSwitch.IsOn = device.AutoConnectEnabled;
        DisconnectButton.IsEnabled = device.IsConnected;

        var boardType = device.ConnectedBoardType ?? device.LastDetectedBoardType ?? (updater.EspBootloaderConnected ? "esp32s3" : "stm32f042");
        var hardwareUid = device.HardwareUidHex ?? device.LastDetectedHardwareUidHex;
        var isEsp = string.Equals(boardType, "esp32s3", StringComparison.OrdinalIgnoreCase) || updater.EspBootloaderConnected;
        var currentDeviceIsRegistered = !string.IsNullOrWhiteSpace(hardwareUid) && accountDevices.HasOfflineAccess(boardType, hardwareUid!);
        var claimStatusResolved = string.IsNullOrWhiteSpace(hardwareUid) || accountDevices.ClaimStatusResolved(boardType, hardwareUid!, AppServices.CloudAuth.IsSignedIn);

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
        HardwareUidText.Text = string.IsNullOrWhiteSpace(hardwareUid) ? string.Empty : $"Hardware UID: {hardwareUid}";
        SecureText.Text = device.IsConnected
            ? (currentDeviceIsRegistered ? "Claim status: Claimed" : "Claim status: Unclaimed")
            : string.Empty;
        DeviceIdText.Text = string.Empty;
        AttachStatusText.Text = string.Empty;
        ClaimStatusText.Text = BuildClaimStatusText(isEsp, currentDeviceIsRegistered, claimStatusResolved);
        OfflineStatusText.Text = accountDevices.IsOfflineMode
            ? (currentDeviceIsRegistered ? "This device is available in Offline Mode." : "This device needs online activation before it can be used in Offline Mode.")
            : (AppServices.CloudAuth.IsSignedIn ? "Signed in." : "Sign in to claim and sync devices.");
        UpdateModeStatusText.Text = updater.EspBootloaderConnected
            ? $"ESP bootloader detected on {updater.EspBootloaderPort ?? "serial port"}."
            : ((updater.DfuConnected || device.DfuConnected) ? "STM32 Update Mode detected." : "Update Mode not detected.");
        VerificationText.Text = string.Empty;
        ErrorText.Text = updater.UpdateError ?? device.LastErrorText ?? accountDevices.LastError ?? string.Empty;

        FirmwareProgressBar.Value = updater.ProgressPct;
        FirmwareProgressText.Text = updater.IsFlashing
            ? $"{(string.IsNullOrWhiteSpace(updater.ProgressMessage) ? "Updating..." : updater.ProgressMessage)} ({(int)Math.Round(updater.ProgressPct)}%)"
            : (updater.UpdateDone ? updater.CompletionMessage : "Open the firmware action to claim or update this device.");
        FirmwareStatusText.Text = isEsp
            ? "ESP32-S3 uses serial flashing on the flash-capable USB port."
            : "STM32 uses the managed DFU update flow.";
        ActivityLogTextBox.Text = string.IsNullOrWhiteSpace(updater.LogText) ? "No activity yet." : updater.LogText;

        UpdateModeButton.Content = isEsp ? "Refresh bootloader" : "Enter Update Mode";
        UpdateModeButton.IsEnabled = !updater.IsFlashing && (isEsp || device.IsConnected);
        PrimaryFirmwareButton.Content = GetPrimaryFirmwareTitle(isEsp, currentDeviceIsRegistered, claimStatusResolved);
        PrimaryFirmwareButton.IsEnabled = !updater.IsFlashing && CanRunFirmwareAction(isEsp, currentDeviceIsRegistered, claimStatusResolved, device, updater);

        DevicesIntroText.Text = accountDevices.IsOfflineMode
            ? "Cached devices available in Offline Mode."
            : "Your claimed and recently seen EMWaver devices.";
    }

    private static string BuildClaimStatusText(bool isEsp, bool currentDeviceIsRegistered, bool claimStatusResolved)
    {
        if (!claimStatusResolved)
        {
            return isEsp
                ? "Checking whether this ESP32-S3 is already claimed."
                : "Checking whether this device is already claimed.";
        }
        if (currentDeviceIsRegistered)
        {
            return isEsp
                ? "This ESP32-S3 is claimed and ready to flash."
                : "This device is claimed and ready to update.";
        }
        return isEsp
            ? "This ESP32-S3 is not claimed yet. Sign in and flash EMWaver firmware."
            : "This device is not claimed yet. Sign in to claim and provision it.";
    }

    private static string GetPrimaryFirmwareTitle(bool isEsp, bool currentDeviceIsRegistered, bool claimStatusResolved)
    {
        if (!claimStatusResolved) return "Checking device";
        if (currentDeviceIsRegistered) return isEsp ? "Flash firmware" : "Update firmware";
        return isEsp ? "Claim and flash" : "Claim device";
    }

    private static bool CanRunFirmwareAction(bool isEsp, bool currentDeviceIsRegistered, bool claimStatusResolved, WindowsDeviceManager device, FirmwareUpdateManager updater)
    {
        if (!claimStatusResolved || updater.IsFlashing) return false;
        if (isEsp)
        {
            var bootloaderReady = updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(updater.EspBootloaderPort);
            return currentDeviceIsRegistered ? bootloaderReady : (bootloaderReady && AppServices.CloudAuth.IsSignedIn);
        }
        if (currentDeviceIsRegistered)
        {
            return device.IsConnected || updater.DfuConnected;
        }
        return device.IsConnected && AppServices.CloudAuth.IsSignedIn;
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
