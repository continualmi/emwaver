using System;
using System.Windows;
using System.Windows.Threading;
using EMWaver.Services;

namespace EMWaver.Views;

public partial class FirmwareUpdateWindow : Window
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _updater;
    private readonly DispatcherTimer _refreshTimer;

    private bool _isFlashing;

    public FirmwareUpdateWindow(WindowsDeviceManager device, FirmwareUpdateManager updater, string? boardType = null)
    {
        InitializeComponent();
        _device = device;
        _updater = updater;

        _updater.ResetForPresent(boardType);
        _updater.PropertyChanged += OnUpdaterPropertyChanged;
        _device.PropertyChanged += OnDevicePropertyChanged;

        _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
        _refreshTimer.Tick += async (_, __) =>
        {
            if (!_isFlashing) await _updater.RefreshDfuPresenceAsync();
        };

        Closed += (_, __) =>
        {
            _updater.PropertyChanged -= OnUpdaterPropertyChanged;
            _device.PropertyChanged -= OnDevicePropertyChanged;
            _refreshTimer.Stop();
        };

        Loaded += async (_, __) =>
        {
            // Render the board-appropriate content before probing. The initial
            // ESP serial/DFU probe can take long enough on a cold app start for
            // WPF to show the dialog with both panels still collapsed.
            UpdateUi();
            await _updater.RefreshDfuPresenceAsync(includeEspSerialProbe: true);
            UpdateUi();
            _refreshTimer.Start();
        };

        // The XAML starts with both workflow panels collapsed. Initialize the
        // visible workflow immediately so the first dialog open is never blank.
        UpdateUi();
    }

    private bool IsEspWorkflow
    {
        get
        {
            var bt = _updater.PresentedBoardType ?? "";
            return bt.StartsWith("esp", StringComparison.OrdinalIgnoreCase) ||
                   _updater.EspBootloaderConnected ||
                   !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort);
        }
    }

    private void OnDevicePropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Dispatcher.Invoke(UpdateUi);
    }

    private void OnUpdaterPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Dispatcher.Invoke(UpdateUi);
    }

    private void UpdateUi()
    {
        if (_updater.IsFlashing)
        {
            _isFlashing = true;
            ShowFlashingState();
            return;
        }

        if (_updater.UpdateDone)
        {
            ShowDoneState();
            return;
        }

        if (!string.IsNullOrWhiteSpace(_updater.UpdateError))
        {
            ShowErrorState(_updater.UpdateError);
            return;
        }

        if (IsEspWorkflow)
        {
            ShowEspState();
        }
        else
        {
            ShowStmState();
        }
    }

    private void ShowStmState()
    {
        StmPanel.Visibility = Visibility.Visible;
        EspPanel.Visibility = Visibility.Collapsed;

        var dfuReady = _updater.DfuConnected || _device.DfuConnected;

        if (dfuReady && !_isFlashing)
        {
            StmTitle.Text = "Flash device";
            StmSubtitle.Text = "The device is in Update Mode and ready to flash.";
            StmErrorCard.Visibility = Visibility.Collapsed;
            StmStatusCard.Visibility = Visibility.Collapsed;
            StmPromptCard.Visibility = Visibility.Visible;
            StmPromptTitle.Text = "Do you want to flash the device?";
            StmPromptBody.Text = "The board is connected in Update Mode. Flashing will install the managed EMWaver firmware bundled with this app.";
            StmProgressPanel.Visibility = Visibility.Collapsed;

            CancelButton.Visibility = Visibility.Visible;
            CancelButton.Content = "Close";
            NotNowButton.Visibility = Visibility.Visible;
            PrimaryButton.Visibility = Visibility.Visible;
            PrimaryButton.Content = "Flash";
            PrimaryButton.Width = 100;
            TryAgainButton.Visibility = Visibility.Collapsed;
        }
        else
        {
            StmTitle.Text = "Install firmware";
            StmSubtitle.Text = "This firmware can be updated from the local app.";
            StmErrorCard.Visibility = Visibility.Collapsed;
            StmStatusCard.Visibility = Visibility.Collapsed;
            StmPromptCard.Visibility = Visibility.Visible;
            StmPromptTitle.Text = "Do you want to put this device into Update Mode?";
            StmPromptBody.Text = "EMWaver can talk to the board. The app can switch it into Update Mode and prepare the local flash flow for you.";
            StmProgressPanel.Visibility = Visibility.Collapsed;

            CancelButton.Visibility = Visibility.Visible;
            CancelButton.Content = "Close";
            NotNowButton.Visibility = Visibility.Visible;
            PrimaryButton.Visibility = Visibility.Visible;
            PrimaryButton.Content = "Enter Update Mode";
            PrimaryButton.Width = 140;
            TryAgainButton.Visibility = Visibility.Collapsed;
        }
    }

    private void ShowEspState()
    {
        StmPanel.Visibility = Visibility.Collapsed;
        EspPanel.Visibility = Visibility.Visible;

        var espReady = _updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort);

        if (!string.IsNullOrWhiteSpace(_updater.EspBootloaderPort))
            EspBootloaderText.Text = $"Detected on {_updater.EspBootloaderPort}.";
        else if (_updater.EspBootloaderConnected)
            EspBootloaderText.Text = "Detected.";
        else if (!string.IsNullOrWhiteSpace(_updater.EspDetectionError))
            EspBootloaderText.Text = $"Detection error: {_updater.EspDetectionError}";
        else
            EspBootloaderText.Text = "Not detected yet. Put the board in bootloader mode, then click Refresh.";

        EspBootloaderText.Foreground = espReady
            ? FindResource("PlotLineBrush") as System.Windows.Media.Brush
            : System.Windows.SystemColors.GrayTextBrush;

        EspFlashButton.IsEnabled = espReady && !_isFlashing;
        EspErrorCard.Visibility = Visibility.Collapsed;
        EspProgressPanel.Visibility = Visibility.Collapsed;
        EspDoneCard.Visibility = Visibility.Collapsed;
    }

    private void ShowFlashingState()
    {
        if (IsEspWorkflow)
        {
            StmPanel.Visibility = Visibility.Collapsed;
            EspPanel.Visibility = Visibility.Visible;
            EspProgressPanel.Visibility = Visibility.Visible;
            EspDoneCard.Visibility = Visibility.Collapsed;
            EspErrorCard.Visibility = Visibility.Collapsed;
            EspFlashButton.IsEnabled = false;

            EspProgressText.Text = string.IsNullOrWhiteSpace(_updater.ProgressMessage)
                ? "Flashing firmware..." : _updater.ProgressMessage;
            EspProgressPct.Text = $"{_updater.ProgressPct:F0}%";
            EspProgressBar.Value = _updater.ProgressPct;

            // Live-update the raw log if it's visible.
            if (EspRawLog.Visibility == Visibility.Visible)
            {
                var lines = _updater.GetEspHelperLog();
                EspRawLog.Text = lines.Count == 0
                    ? "(No output captured yet)"
                    : string.Join(Environment.NewLine, lines);
                EspRawLog.ScrollToEnd();
            }
        }
        else
        {
            StmPanel.Visibility = Visibility.Visible;
            EspPanel.Visibility = Visibility.Collapsed;
            StmProgressPanel.Visibility = Visibility.Visible;
            StmPromptCard.Visibility = Visibility.Collapsed;
            StmErrorCard.Visibility = Visibility.Collapsed;
            StmStatusCard.Visibility = Visibility.Collapsed;

            StmProgressText.Text = string.IsNullOrWhiteSpace(_updater.ProgressMessage)
                ? "Flashing firmware..." : _updater.ProgressMessage;
            StmProgressPct.Text = $"{_updater.ProgressPct:F0}%";
            StmProgressBar.Value = _updater.ProgressPct;

            CancelButton.Visibility = Visibility.Visible;
            CancelButton.Content = "Close";
            NotNowButton.Visibility = Visibility.Collapsed;
            PrimaryButton.Visibility = Visibility.Collapsed;
            TryAgainButton.Visibility = Visibility.Collapsed;
        }
    }

    private void ShowErrorState(string error)
    {
        _isFlashing = false;

        if (IsEspWorkflow)
        {
            EspErrorCard.Visibility = Visibility.Visible;
            EspErrorText.Text = ExplainFirmwareError(error, esp: true);
            EspProgressPanel.Visibility = Visibility.Collapsed;
            EspDoneCard.Visibility = Visibility.Collapsed;
        }
        else
        {
            StmErrorCard.Visibility = Visibility.Visible;
            StmErrorText.Text = ExplainFirmwareError(error, esp: false);
            StmProgressPanel.Visibility = Visibility.Collapsed;
            StmPromptCard.Visibility = Visibility.Collapsed;
            StmStatusCard.Visibility = Visibility.Collapsed;

            CancelButton.Visibility = Visibility.Visible;
            CancelButton.Content = "Close";
            NotNowButton.Visibility = Visibility.Collapsed;
            PrimaryButton.Visibility = Visibility.Collapsed;
            TryAgainButton.Visibility = Visibility.Visible;
        }
    }

    private void ShowDoneState()
    {
        _isFlashing = false;

        if (IsEspWorkflow)
        {
            EspProgressPanel.Visibility = Visibility.Collapsed;
            EspErrorCard.Visibility = Visibility.Collapsed;
            EspDoneCard.Visibility = Visibility.Visible;
            EspDoneText.Text = _updater.CompletionMessage;
            EspFlashButton.IsEnabled = false;
        }
        else
        {
            StmProgressPanel.Visibility = Visibility.Collapsed;
            StmErrorCard.Visibility = Visibility.Collapsed;
            StmPromptCard.Visibility = Visibility.Collapsed;
            StmStatusCard.Visibility = Visibility.Visible;
            StmStatusText.Text = _updater.CompletionMessage;
            StmTitle.Text = "Reconnect device";

            CancelButton.Visibility = Visibility.Visible;
            CancelButton.Content = "Done";
            NotNowButton.Visibility = Visibility.Collapsed;
            PrimaryButton.Visibility = Visibility.Collapsed;
            TryAgainButton.Visibility = Visibility.Collapsed;
        }
    }

    private static string ExplainFirmwareError(string error, bool esp)
    {
        var text = (error ?? string.Empty).Trim();
        var lower = text.ToLowerInvariant();
        if (esp)
        {
            if (lower.Contains("asset") || lower.Contains("file") || lower.Contains("not found"))
            {
                return text + "\n\nFirmware asset missing. Rebuild the app so Assets/Firmware contains the bundled ESP images.";
            }
            if (lower.Contains("port") || lower.Contains("serial") || lower.Contains("boot"))
            {
                return text + "\n\nRecovery: hold BOOT, press/release RESET, click Refresh, then Flash firmware again. Keep BOOT held until flashing starts.";
            }
            return text + "\n\nIf flashing does not start, put the board back into bootloader mode and click Refresh. Keep BOOT held until flashing starts.";
        }

        if (lower.Contains("dfu") || lower.Contains("update mode"))
        {
            return text + "\n\nRecovery: reconnect the board, enter Update Mode again, then click Try again.";
        }
        if (lower.Contains("asset") || lower.Contains("firmware") || lower.Contains("not found"))
        {
            return text + "\n\nFirmware asset missing. Rebuild the app so the bundled firmware payload is copied to the app output.";
        }
        return text;
    }

    private async void OnPrimaryClick(object sender, RoutedEventArgs e)
    {
        var dfuReady = _updater.DfuConnected || _device.DfuConnected;

        if (!dfuReady && !IsEspWorkflow)
        {
            // STM32: enter update mode first
            _device.RequestEnterUpdateMode();
            _device.Disconnect();
            await _updater.RefreshDfuPresenceAsync();
            return;
        }

        await _updater.StartUpdateAsync(_device);
    }

    private async void OnEspFlashClick(object sender, RoutedEventArgs e)
    {
        await _updater.StartUpdateAsync(_device);
    }

    private async void OnEspRefreshClick(object sender, RoutedEventArgs e)
    {
        await _updater.RefreshDfuPresenceAsync(includeEspSerialProbe: true);
    }

    private void OnEspShowLogChanged(object sender, RoutedEventArgs e)
    {
        var visible = EspShowLogCheckbox.IsChecked == true;
        EspRawLog.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (!visible) return;
        var lines = _updater.GetEspHelperLog();
        EspRawLog.Text = lines.Count == 0
            ? "(No output captured yet)"
            : string.Join(Environment.NewLine, lines);
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        Close();
    }
}