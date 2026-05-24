using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using EMWaver.Services;
using EMWaver.Services.Agent;
using EMWaver.Views;

namespace EMWaver;

public partial class MainWindow : Window
{
    private readonly ScriptsView _scriptsView;
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _firmwareUpdater;
    private readonly AgentApiKeyStore _agentKeys;
    private readonly DispatcherTimer _runningPulseTimer;
    private bool _runningPulseBright = true;

    public MainWindow()
    {
        InitializeComponent();

        _scriptsView = ScriptsViewControl;
        _device = AppServices.Device;
        _firmwareUpdater = AppServices.FirmwareUpdater;
        _agentKeys = AppServices.AgentKeys;

        // Wire up dispatchers.
        _device.AttachUiDispatcher(Dispatcher);
        _firmwareUpdater.AttachUiDispatcher(Dispatcher);

        // Set window icon.
        TrySetWindowIcon();

        // Subscribe to device state changes.
        _device.PropertyChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        _firmwareUpdater.PropertyChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);
        _device.AvailablePorts.CollectionChanged += (_, __) => Dispatcher.Invoke(UpdateDeviceStatus);

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
            UpdateAgentKeyIndicator();
        };

        Closed += (_, __) => _runningPulseTimer.Stop();
    }

    // --- Toolbar handlers ---

    private void OnDeviceMenuClick(object sender, RoutedEventArgs e)
    {
        var window = new DeviceConnectionWindow(_device, _firmwareUpdater)
        {
            Owner = this,
        };
        window.ShowDialog();
        UpdateDeviceStatus();
    }

    private void OnAgentKeyClick(object sender, RoutedEventArgs e)
    {
        var window = new AgentKeyWindow(_agentKeys)
        {
            Owner = this,
        };
        window.ShowDialog();
        UpdateAgentKeyIndicator();
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

        if (!device.IsConnected && _firmwareUpdater.EspBootloaderConnected)
        {
            DeviceStatusText.Text = "ESP Bootloader";
            DeviceIconText.Text = "💾";
        }
        else if (device.IsConnected)
        {
            DeviceStatusText.Text = device.ConnectedPort?.DisplayName ?? "Connected";
            DeviceIconText.Text = "🔌";
        }
        else if (_firmwareUpdater.DfuConnected || device.DfuConnected)
        {
            DeviceStatusText.Text = "Update Mode";
            DeviceIconText.Text = "🔄";
        }
        else
        {
            DeviceStatusText.Text = "Disconnected";
            DeviceIconText.Text = "⚡";
        }

        DeviceVersionText.Text = device.IsConnected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"{(device.ConnectedBoardType ?? device.LastDetectedBoardType ?? "device")} | EMWaver {device.DeviceEmwaverVersion}"
            : "";
    }

    private void UpdateAgentKeyIndicator()
    {
        AgentKeyIcon.Text = _agentKeys.HasAgentKey ? "🔑" : "🔒";
        AgentKeyButton.ToolTip = _agentKeys.HasAgentKey ? "Agent API Key (set)" : "Agent API Key (not set)";
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
                Icon = System.Drawing.Icon.ExtractAssociatedIcon(iconPath);
            }
        }
        catch
        {
            // Non-fatal.
        }
    }
}