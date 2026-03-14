using EMWaver.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.ComponentModel;
using System.Threading.Tasks;

namespace EMWaver.Dialogs;

public sealed partial class FirmwareUpdateDialog : ContentDialog
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _updater;
    private readonly DispatcherQueue _ui = DispatcherQueue.GetForCurrentThread();
    private string? _presentedBoardType;

    internal FirmwareUpdateDialog(WindowsDeviceManager device, FirmwareUpdateManager updater)
    {
        InitializeComponent();
        _device = device;
        _updater = updater;

        _updater.PropertyChanged += OnStateChanged;
        _device.PropertyChanged += OnStateChanged;
        AppServices.AccountDevices.PropertyChanged += OnStateChanged;
        AppServices.CloudAuth.Changed += OnAuthChanged;

        PrimaryButtonClick += OnPrimaryButtonClick;
        Closing += OnClosing;
        Opened += OnOpened;

        UpdateUi();
    }

    internal void SetPresentedBoardType(string? boardType)
    {
        _presentedBoardType = boardType;
    }

    private void OnOpened(ContentDialog sender, ContentDialogOpenedEventArgs args)
    {
        _updater.AttachUiDispatcher(_ui);
        _updater.ResetForPresent(_presentedBoardType);
        _ = _updater.RefreshDfuPresenceAsync();
        AppServices.AccountDevices.Refresh();
        UpdateUi();
    }

    private void OnClosing(ContentDialog sender, ContentDialogClosingEventArgs args)
    {
        if (_updater.IsFlashing)
        {
            args.Cancel = true;
            return;
        }

        _updater.PropertyChanged -= OnStateChanged;
        _device.PropertyChanged -= OnStateChanged;
        AppServices.AccountDevices.PropertyChanged -= OnStateChanged;
        AppServices.CloudAuth.Changed -= OnAuthChanged;
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        args.Cancel = true;

        if (_updater.IsFlashing) return;

        var isEsp = IsEspWorkflow();
        var currentDeviceIsRegistered = CurrentDeviceIsRegistered();

        if (isEsp)
        {
            if (currentDeviceIsRegistered)
            {
                await _updater.StartUpdateAsync(_device);
            }
            else
            {
                await _updater.StartEspClaimAndFlashAsync(AppServices.CloudAuth, AppServices.AccountDevices, _device);
            }
        }
        else
        {
            if (currentDeviceIsRegistered)
            {
                await _updater.StartUpdateAsync(_device);
            }
            else
            {
                await _updater.StartMintAndProvisionAsync(AppServices.CloudAuth, _device);
            }
        }

        UpdateUi();
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        _ = _ui.TryEnqueue(UpdateUi);
    }

    private void OnAuthChanged()
    {
        _ = _ui.TryEnqueue(UpdateUi);
    }

    private async void OnRefreshStateClick(object sender, RoutedEventArgs e)
    {
        await _updater.RefreshDfuPresenceAsync();
        AppServices.AccountDevices.Refresh();
        UpdateUi();
    }

    private async void OnVerifyRunModeClick(object sender, RoutedEventArgs e)
    {
        await _updater.VerifyRunModeIdentityAsync(_device);
        UpdateUi();
    }

    private async void OnVerifyUpdateModeClick(object sender, RoutedEventArgs e)
    {
        await _updater.VerifyUpdateModeIdentityAsync();
        UpdateUi();
    }

    private async void OnOpenAccountClick(object sender, RoutedEventArgs e)
    {
        var dialog = new AccountDialog
        {
            XamlRoot = this.XamlRoot,
        };
        await dialog.ShowAsync();
        UpdateUi();
    }

    private bool IsEspWorkflow()
    {
        var boardType = _presentedBoardType ?? _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? (_updater.EspBootloaderConnected ? "esp32s3" : "stm32f042");
        return string.Equals(boardType, "esp32s3", StringComparison.OrdinalIgnoreCase) || _updater.EspBootloaderConnected;
    }

    private string? CurrentHardwareUid()
    {
        return _device.HardwareUidHex ?? _device.LastDetectedHardwareUidHex;
    }

    private bool CurrentDeviceIsRegistered()
    {
        var hardwareUid = CurrentHardwareUid();
        var boardType = _presentedBoardType ?? _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "stm32f042";
        return !string.IsNullOrWhiteSpace(hardwareUid) &&
               AppServices.AccountDevices.HasOfflineAccess(boardType, hardwareUid!);
    }

    private bool CurrentDeviceClaimStatusResolved()
    {
        var hardwareUid = CurrentHardwareUid();
        var boardType = _presentedBoardType ?? _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "stm32f042";
        return string.IsNullOrWhiteSpace(hardwareUid) ||
               AppServices.AccountDevices.ClaimStatusResolved(boardType, hardwareUid!, AppServices.CloudAuth.IsSignedIn);
    }

    private string PrimaryActionTitle()
    {
        var isEsp = IsEspWorkflow();
        var currentDeviceIsRegistered = CurrentDeviceIsRegistered();
        var claimStatusResolved = CurrentDeviceClaimStatusResolved();

        if (!claimStatusResolved) return "Checking device";
        if (currentDeviceIsRegistered) return isEsp ? "Flash firmware" : "Update device";
        return isEsp ? "Claim and flash" : "Claim device";
    }

    private bool CanRunPrimaryAction()
    {
        var isEsp = IsEspWorkflow();
        var currentDeviceIsRegistered = CurrentDeviceIsRegistered();
        var claimStatusResolved = CurrentDeviceClaimStatusResolved();

        if (!claimStatusResolved || _updater.IsFlashing) return false;
        if (isEsp)
        {
            var bootloaderReady = _updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort);
            return currentDeviceIsRegistered ? bootloaderReady : (bootloaderReady && AppServices.CloudAuth.IsSignedIn);
        }
        if (currentDeviceIsRegistered)
        {
            return _device.IsConnected || _updater.DfuConnected;
        }
        return _device.IsConnected && AppServices.CloudAuth.IsSignedIn;
    }

    private void UpdateUi()
    {
        var isEsp = IsEspWorkflow();
        var boardType = _presentedBoardType ?? _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? (isEsp ? "esp32s3" : "stm32f042");
        var hardwareUid = CurrentHardwareUid();
        var currentDeviceIsRegistered = CurrentDeviceIsRegistered();
        var claimStatusResolved = CurrentDeviceClaimStatusResolved();

        Title = currentDeviceIsRegistered
            ? (isEsp ? "Flash ESP32-S3" : "Update EMWaver")
            : (isEsp ? "Set Up ESP32-S3" : "Set Up EMWaver");
        PrimaryButtonText = PrimaryActionTitle();
        IsPrimaryButtonEnabled = CanRunPrimaryAction();

        SummaryTitleText.Text = isEsp ? "ESP32-S3 device" : "STM32 device";
        SummaryText.Text = currentDeviceIsRegistered
            ? (isEsp ? "This board is already claimed. Flash firmware when the bootloader is ready." : "This device is already claimed. Update firmware when it is connected in Run Mode or Update Mode.")
            : (isEsp ? "Claim this ESP32-S3 and flash managed EMWaver firmware over the serial bootloader path." : "Claim this board and provision managed EMWaver firmware through the DFU flow.");
        BoardInfoText.Text = string.IsNullOrWhiteSpace(hardwareUid)
            ? $"Board: {boardType}"
            : $"Board: {boardType} | Hardware UID: {hardwareUid}";

        if (!claimStatusResolved)
        {
            ClaimStatusText.Text = "Checking whether this board is already claimed.";
        }
        else if (currentDeviceIsRegistered)
        {
            ClaimStatusText.Text = AppServices.CloudAuth.IsSignedIn
                ? "This board is already claimed in your EMWaver account."
                : "This board matches a locally cached claimed device.";
        }
        else
        {
            ClaimStatusText.Text = AppServices.CloudAuth.IsSignedIn
                ? "This board is not claimed yet."
                : "Sign in to claim this board.";
        }

        BootloaderStatusText.Text = isEsp
            ? (_updater.EspBootloaderConnected
                ? $"ESP bootloader detected on {_updater.EspBootloaderPort ?? "serial port"}."
                : "Put the board in BOOT/RESET mode, then click Refresh.")
            : ((_updater.DfuConnected || _device.DfuConnected)
                ? "STM32 Update Mode detected."
                : "Device not in Update Mode yet. The app can request it from Run Mode.");

        SignInStatusText.Text = AppServices.CloudAuth.IsSignedIn
            ? "Signed in."
            : "Sign in stays available even without a connected device.";

        ErrorPanel.Visibility = string.IsNullOrWhiteSpace(_updater.UpdateError) ? Visibility.Collapsed : Visibility.Visible;
        ErrorText.Text = _updater.UpdateError ?? "";

        ProgressPanel.Visibility = (_updater.IsFlashing || !string.IsNullOrWhiteSpace(_updater.LastVerificationText)) ? Visibility.Visible : Visibility.Collapsed;
        ProgressMessageText.Text = string.IsNullOrWhiteSpace(_updater.ProgressMessage) ? "Idle" : _updater.ProgressMessage;
        ProgressPctText.Text = $"{(int)Math.Round(_updater.ProgressPct)}%";
        ProgressBar.Value = _updater.ProgressPct;
        VerificationText.Text = _updater.LastVerificationText;

        DonePanel.Visibility = _updater.UpdateDone ? Visibility.Visible : Visibility.Collapsed;
        DoneText.Text = _updater.CompletionMessage;

        VerifyRunModeButton.IsEnabled = _device.IsConnected && !_updater.IsFlashing;
        VerifyUpdateModeButton.IsEnabled = !isEsp && (_updater.DfuConnected || _device.DfuConnected) && !_updater.IsFlashing;
        RefreshStateButton.IsEnabled = !_updater.IsFlashing;
        OpenAccountButton.IsEnabled = !_updater.IsFlashing;

        ActivityLogTextBox.Text = string.IsNullOrWhiteSpace(_updater.LogText) ? "No activity yet." : _updater.LogText;
    }
}
