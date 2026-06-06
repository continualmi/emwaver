using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using EMWaver.Models;
using EMWaver.Services;

namespace EMWaver.ViewModels;

public class MainViewModel : INotifyPropertyChanged
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _firmwareUpdater;
    private readonly ScriptRepository _scripts;
    private readonly AppSettings _settings;

    public MainViewModel(
        WindowsDeviceManager device,
        FirmwareUpdateManager firmwareUpdater,
        ScriptRepository scripts,
        AppSettings settings)
    {
        _device = device;
        _firmwareUpdater = firmwareUpdater;
        _scripts = scripts;
        _settings = settings;

        _device.PropertyChanged += (_, __) => RefreshDeviceState();
        _firmwareUpdater.PropertyChanged += (_, __) => RefreshDeviceState();
        _device.AvailablePorts.CollectionChanged += (_, __) => RefreshDeviceState();
    }

    // --- Device picker state ---

    private string _deviceStatusText = "Disconnected";
    public string DeviceStatusText
    {
        get => _deviceStatusText;
        set { _deviceStatusText = value; OnPropertyChanged(); }
    }

    private string _deviceVersionText = "";
    public string DeviceVersionText
    {
        get => _deviceVersionText;
        set { _deviceVersionText = value; OnPropertyChanged(); }
    }

    private bool _isConnected;
    public bool IsConnected
    {
        get => _isConnected;
        set { _isConnected = value; OnPropertyChanged(); }
    }

    private string _connectedTransportKind = "";
    public string ConnectedTransportKind
    {
        get => _connectedTransportKind;
        set { _connectedTransportKind = value; OnPropertyChanged(); }
    }

    private bool _autoConnectEnabled = true;
    public bool AutoConnectEnabled
    {
        get => _autoConnectEnabled;
        set
        {
            _autoConnectEnabled = value;
            _device.AutoConnectEnabled = value;
            OnPropertyChanged();
        }
    }

    // --- Script state ---

    private bool _isScriptRunning;
    public bool IsScriptRunning
    {
        get => _isScriptRunning;
        set { _isScriptRunning = value; OnPropertyChanged(); }
    }

    private string _runningScriptName = "";
    public string RunningScriptName
    {
        get => _runningScriptName;
        set { _runningScriptName = value; OnPropertyChanged(); }
    }

    // --- Commands ---

    public ICommand OpenDeviceOptionsCommand => new RelayCommand(_ => OpenDeviceOptionsRequested?.Invoke());
    public ICommand OpenSettingsCommand => new RelayCommand(_ => OpenSettingsRequested?.Invoke());
    public ICommand RefreshPortsCommand => new RelayCommand(async _ => await _device.RefreshPortsAsync());
    public ICommand DisconnectCommand => new RelayCommand(_ => _device.Disconnect());

    public event Action? OpenDeviceOptionsRequested;
    public event Action? OpenSettingsRequested;

    // --- Private ---

    private void RefreshDeviceState()
    {
        var device = _device;

        if (!device.IsConnected && _firmwareUpdater.EspBootloaderConnected)
        {
            DeviceStatusText = "ESP Bootloader";
        }
        else if (device.IsConnected)
        {
            var targetLabel = device.ConnectedPort?.DisplayName;
            DeviceStatusText = string.IsNullOrWhiteSpace(targetLabel) ? "Connected" : targetLabel;
        }
        else if (_firmwareUpdater.DfuConnected || device.DfuConnected)
        {
            DeviceStatusText = "Update Mode";
        }
        else
        {
            DeviceStatusText = "Disconnected";
        }

        IsConnected = device.IsConnected;
        ConnectedTransportKind = device.IsConnected ? "USB" : "";
        AutoConnectEnabled = device.AutoConnectEnabled;

        DeviceVersionText = device.IsConnected && !string.IsNullOrWhiteSpace(device.DeviceEmwaverVersion)
            ? $"{(device.ConnectedBoardType ?? device.LastDetectedBoardType ?? "device")} | EMWaver {device.DeviceEmwaverVersion}"
            : "";

    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
