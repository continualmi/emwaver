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
    }

    private async void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        args.Cancel = true;

        if (_updater.IsFlashing) return;

        await _updater.StartUpdateAsync(_device);

        UpdateUi();
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        _ = _ui.TryEnqueue(UpdateUi);
    }

    private async void OnRefreshStateClick(object sender, RoutedEventArgs e)
    {
        await _updater.RefreshDfuPresenceAsync();
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

    private string PrimaryActionTitle()
    {
        return IsEspWorkflow() ? "Flash firmware" : "Update device";
    }

    private bool CanRunPrimaryAction()
    {
        var isEsp = IsEspWorkflow();
        if (_updater.IsFlashing) return false;
        if (isEsp)
        {
            var bootloaderReady = _updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort);
            return bootloaderReady;
        }
        return _device.IsConnected || _updater.DfuConnected;
    }

    private void UpdateUi()
    {
        var isEsp = IsEspWorkflow();
        var boardType = _presentedBoardType ?? _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? (isEsp ? "esp32s3" : "stm32f042");

        Title = isEsp ? "Flash ESP32-S3" : "Update EMWaver";
        PrimaryButtonText = PrimaryActionTitle();
        IsPrimaryButtonEnabled = CanRunPrimaryAction();

        SummaryTitleText.Text = isEsp ? "ESP32-S3 device" : "STM32 device";
        SummaryText.Text = isEsp
            ? "Flash managed EMWaver firmware over the serial bootloader path."
            : "Update managed EMWaver firmware through the DFU flow.";
        BoardInfoText.Text = $"Board: {boardType}";

        ClaimStatusText.Text = "";

        BootloaderStatusText.Text = isEsp
            ? (_updater.EspBootloaderConnected
                ? $"ESP bootloader detected on {_updater.EspBootloaderPort ?? "serial port"}."
                : "Put the board in BOOT/RESET mode, then click Refresh.")
            : ((_updater.DfuConnected || _device.DfuConnected)
                ? "STM32 Update Mode detected."
                : "Device not in Update Mode yet. The app can request it from Run Mode.");

        SignInStatusText.Text = "";

        ErrorPanel.Visibility = string.IsNullOrWhiteSpace(_updater.UpdateError) ? Visibility.Collapsed : Visibility.Visible;
        ErrorText.Text = _updater.UpdateError ?? "";

        ProgressPanel.Visibility = _updater.IsFlashing ? Visibility.Visible : Visibility.Collapsed;
        ProgressMessageText.Text = string.IsNullOrWhiteSpace(_updater.ProgressMessage) ? "Idle" : _updater.ProgressMessage;
        ProgressPctText.Text = $"{(int)Math.Round(_updater.ProgressPct)}%";
        ProgressBar.Value = _updater.ProgressPct;

        DonePanel.Visibility = _updater.UpdateDone ? Visibility.Visible : Visibility.Collapsed;
        DoneText.Text = _updater.CompletionMessage;

        RefreshStateButton.IsEnabled = !_updater.IsFlashing;
        OpenAccountButton.IsEnabled = !_updater.IsFlashing;

        ActivityLogTextBox.Text = string.IsNullOrWhiteSpace(_updater.LogText) ? "No activity yet." : _updater.LogText;
    }
}
