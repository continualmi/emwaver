using EMWaver.Services;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.ComponentModel;

namespace EMWaver.Dialogs;

public sealed partial class FirmwareUpdateDialog : ContentDialog
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _updater;
    private readonly DispatcherQueue _ui = DispatcherQueue.GetForCurrentThread();

    internal FirmwareUpdateDialog(WindowsDeviceManager device, FirmwareUpdateManager updater)
    {
        InitializeComponent();
        _device = device;
        _updater = updater;

        _updater.PropertyChanged += OnUpdaterPropertyChanged;

        PrimaryButtonClick += OnPrimaryButtonClick;
        Closing += OnClosing;
        Opened += OnOpened;

        UpdateUi();
    }

    private void OnOpened(ContentDialog sender, ContentDialogOpenedEventArgs args)
    {
        // Ensure updater marshals UI-visible state changes via a UI dispatcher.
        _updater.AttachUiDispatcher(_ui);

        _updater.ResetForPresent();
        _ = _updater.RefreshDfuPresenceAsync();
        UpdateUi();
    }

    private void OnClosing(ContentDialog sender, ContentDialogClosingEventArgs args)
    {
        // Prevent closing while flashing (matches macOS sheet behavior).
        if (_updater.IsFlashing)
        {
            args.Cancel = true;
            return;
        }

        _updater.PropertyChanged -= OnUpdaterPropertyChanged;
    }

    private void OnPrimaryButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        args.Cancel = true; // keep dialog open
        _ = _updater.StartUpdateAsync(_device);
    }

    private void OnUpdaterPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        // FirmwareUpdateManager updates can come from background threads (DFU polling, flashing).
        // ContentDialog UI must only be touched on the UI thread.
        _ = _ui.TryEnqueue(UpdateUi);
    }

    private void UpdateUi()
    {
        // Panels
        var hasDeviceRunMode = _device.IsConnected && !_updater.UpdateDone;
        RunModePanel.Visibility = hasDeviceRunMode ? Visibility.Visible : Visibility.Collapsed;

        if (hasDeviceRunMode && !string.IsNullOrWhiteSpace(_device.DeviceEmwaverVersion))
        {
            DetectedVersionText.Text = $"Detected version: EMWaver {_device.DeviceEmwaverVersion}";
            DetectedVersionText.Visibility = Visibility.Visible;
        }
        else
        {
            DetectedVersionText.Text = "";
            DetectedVersionText.Visibility = Visibility.Collapsed;
        }

        NeedDfuPanel.Visibility = (!_updater.DfuConnected && !_updater.UpdateDone) ? Visibility.Visible : Visibility.Collapsed;
        DfuDetectedPanel.Visibility = (_updater.DfuConnected && !_updater.UpdateDone) ? Visibility.Visible : Visibility.Collapsed;

        if (!string.IsNullOrWhiteSpace(_updater.UpdateError) && !_updater.UpdateDone)
        {
            ErrorText.Text = _updater.UpdateError ?? "";
            ErrorPanel.Visibility = Visibility.Visible;
        }
        else
        {
            ErrorText.Text = "";
            ErrorPanel.Visibility = Visibility.Collapsed;
        }

        ProgressPanel.Visibility = _updater.IsFlashing ? Visibility.Visible : Visibility.Collapsed;
        ProgressMessageText.Text = string.IsNullOrWhiteSpace(_updater.ProgressMessage) ? "Updating..." : _updater.ProgressMessage;
        ProgressPctText.Text = $"{(int)System.Math.Round(_updater.ProgressPct)}%";
        ProgressBar.Value = _updater.ProgressPct;

        DonePanel.Visibility = _updater.UpdateDone ? Visibility.Visible : Visibility.Collapsed;

        // Buttons
        IsPrimaryButtonEnabled = (!_updater.IsFlashing) && (!_updater.UpdateDone) && (_device.IsConnected || _updater.DfuConnected);
        // Note: ContentDialog has no IsCloseButtonEnabled; Closing handler cancels while flashing.
    }
}
