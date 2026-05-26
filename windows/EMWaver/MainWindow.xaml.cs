using System;
using System.IO;
using System.Windows;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using EMWaver.Services;
using EMWaver.Views;

namespace EMWaver;

public partial class MainWindow : Window
{
    private readonly ScriptsView _scriptsView;
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _firmwareUpdater;
    private readonly DispatcherTimer _runningPulseTimer;
    private bool _runningPulseBright = true;

    public MainWindow()
    {
        InitializeComponent();

        _scriptsView = ScriptsViewControl;
        _device = AppServices.Device;
        _firmwareUpdater = AppServices.FirmwareUpdater;

        // Wire up dispatchers.
        _device.AttachUiDispatcher(Dispatcher);
        _device.BeginConnectionMonitoring();
        _firmwareUpdater.AttachUiDispatcher(Dispatcher);

        // Set window icon. Build details live in Settings.
        TrySetWindowIcon();
        Title = "EMWaver";

        // Subscribe to device state changes.
        _device.PropertyChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        _firmwareUpdater.PropertyChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        _device.AvailablePorts.CollectionChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        _device.BleDiscoveredDevices.CollectionChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        AppServices.Settings.Changed += OnSettingsChanged;

        // Script view events.
        _scriptsView.PreviewModeChanged += OnPreviewModeChanged;
        _scriptsView.RunningScriptStatusChanged += OnRunningScriptStatusChanged;

        // Running pulse timer.
        _runningPulseTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(550) };
        _runningPulseTimer.Tick += OnRunningPulseTick;

        // Bootstrap.
        Loaded += async (_, __) =>
        {
            await AppServices.Scripts.EnsureBootstrappedAsync();
            await _device.RefreshPortsAsync();
            UpdateDeviceStatus();
        };

        Closed += (_, __) =>
        {
            _runningPulseTimer.Stop();
            AppServices.Settings.Changed -= OnSettingsChanged;
        };
    }

    // --- Toolbar handlers ---

    private void OnSettingsChanged()
    {
        if (_device.IsConnected)
        {
            _device.ApplyTransportDebugPreference();
        }
    }

    private void OnDeviceMenuClick(object sender, RoutedEventArgs e)
    {
        var window = new DeviceConnectionWindow(_device, _firmwareUpdater)
        {
            Owner = this,
        };
        window.ShowDialog();
        UpdateDeviceStatus();
    }

    private void OnCodeModeClick(object sender, RoutedEventArgs e)
    {
        if (CodeModeToggle.IsChecked == true)
        {
            PreviewModeToggle.IsChecked = false;
            _scriptsView.HandleTogglePreview(false);
        }
        else
        {
            CodeModeToggle.IsChecked = true;
        }
    }

    private void OnPreviewModeClick(object sender, RoutedEventArgs e)
    {
        if (PreviewModeToggle.IsChecked == true)
        {
            CodeModeToggle.IsChecked = false;
            _scriptsView.HandleTogglePreview(true);
        }
        else
        {
            PreviewModeToggle.IsChecked = true;
        }
    }

    private void OnAgentToggleClick(object sender, RoutedEventArgs e)
    {
        _scriptsView.HandleToggleAgent();
    }

    private void OnStopClick(object sender, RoutedEventArgs e)
    {
        _ = _scriptsView.HandleStopRunning();
    }

    private void OnNewClick(object sender, RoutedEventArgs e) => _scriptsView.HandleNewScript();
    private void OnSaveClick(object sender, RoutedEventArgs e) => _scriptsView.HandleSaveScript();
    private void OnMakeCopyClick(object sender, RoutedEventArgs e) => _scriptsView.HandleMakeCopy();
    private void OnRenameClick(object sender, RoutedEventArgs e) => _scriptsView.HandleRename();
    private void OnDeleteClick(object sender, RoutedEventArgs e) => _scriptsView.HandleDelete();
    private void OnMoreClick(object sender, RoutedEventArgs e)
    {
        MoreButton.ContextMenu.PlacementTarget = MoreButton;
        MoreButton.ContextMenu.IsOpen = true;
    }
    private void OnCheckForUpdatesClick(object sender, RoutedEventArgs e)
    {
        var window = new AppUpdateWindow(AppServices.AppUpdates)
        {
            Owner = this,
        };
        window.ShowDialog();
    }
    private void OnSettingsClick(object sender, RoutedEventArgs e)
    {
        var vm = new ViewModels.SettingsViewModel(AppServices.Settings);
        var window = new SettingsWindow(vm)
        {
            Owner = this,
        };
        window.ShowDialog();
    }

    // --- Device status ---

    private void UpdateDeviceStatus()
    {
        var device = _device;

        // A live Run Mode transport is authoritative. ESP serial bootloader
        // detection is a point-in-time probe and can be stale after the user
        // resets the board back into BLE/USB/Wi-Fi runtime.
        if (device.IsConnected)
        {
            _firmwareUpdater.ClearEspBootloaderPresence();
            DeviceStatusText.Text = BoardDisplayName(device.ConnectedBoardType ?? device.LastDetectedBoardType) ?? (device.ConnectedPort?.DisplayName ?? "Connected");
            DeviceIconText.Text = device.ActiveTransport switch
            {
                DeviceTransport.Ble => "📡",
                DeviceTransport.Wifi => "📶",
                _ => "🔌",
            };
        }
        else if (_firmwareUpdater.EspBootloaderConnected)
        {
            DeviceStatusText.Text = "ESP Bootloader";
            DeviceIconText.Text = "💾";
        }
        else if (_firmwareUpdater.DfuConnected || device.DfuConnected)
        {
            DeviceStatusText.Text = "Update Mode";
            DeviceIconText.Text = "🔄";
        }
        else if (device.IsBleConnecting)
        {
            DeviceStatusText.Text = "Connecting BLE";
            DeviceIconText.Text = "📡";
        }
        else if (device.IsBleScanning)
        {
            DeviceStatusText.Text = "Scanning";
            DeviceIconText.Text = "📡";
        }
        else
        {
            DeviceStatusText.Text = "Disconnected";
            DeviceIconText.Text = "⚡";
        }

        DeviceVersionText.Text = device.IsConnected
            ? $"{device.ActiveTransport}{(string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion) ? "" : $" | EMWaver {device.DeviceEmwaverVersion}")}"
            : "";
    }

    private static string? BoardDisplayName(string? boardType)
    {
        return (boardType ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "stm32f042" => "STM32F042",
            "esp32s2" => "ESP32-S2",
            "esp32s3" => "ESP32-S3",
            "esp32" => "ESP32",
            "" => null,
            var other => other.ToUpperInvariant(),
        };
    }

    // --- Preview mode ---

    private void OnPreviewModeChanged(bool isPreview)
    {
        CodeModeToggle.IsChecked = !isPreview;
        PreviewModeToggle.IsChecked = isPreview;
    }

    // --- Running indicator ---

    private void OnRunningScriptStatusChanged(bool isRunning, string? scriptName)
    {
        RunningIndicator.Visibility = isRunning ? Visibility.Visible : Visibility.Collapsed;
        StopButton.Visibility = isRunning ? Visibility.Visible : Visibility.Collapsed;

        RunningScriptText.Text = string.IsNullOrWhiteSpace(scriptName)
            ? "Running" : $"Running: {scriptName}";

        if (isRunning)
        {
            _runningPulseBright = true;
            RunningPulseDot.Opacity = 1;
            _runningPulseTimer.Start();
        }
        else
        {
            _runningPulseTimer.Stop();
        }
    }

    private void OnRunningPulseTick(object? sender, EventArgs e)
    {
        _runningPulseBright = !_runningPulseBright;
        RunningPulseDot.Opacity = _runningPulseBright ? 1 : 0.35;
    }

    // --- Window icon ---

    private void TrySetWindowIcon()
    {
        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "emwaver.ico");
            if (!File.Exists(iconPath))
            {
                iconPath = Path.Combine(AppContext.BaseDirectory, "emwaver.ico");
            }
            if (File.Exists(iconPath))
            {
                Icon = BitmapFrame.Create(new Uri(iconPath, UriKind.Absolute));
            }
        }
        catch
        {
            // Non-fatal.
        }
    }
}
