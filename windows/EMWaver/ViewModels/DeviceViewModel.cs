using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using EMWaver.Models;
using EMWaver.Services;

namespace EMWaver.ViewModels;

public class DeviceViewModel : INotifyPropertyChanged
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _firmwareUpdater;

    public DeviceViewModel(WindowsDeviceManager device, FirmwareUpdateManager firmwareUpdater)
    {
        _device = device;
        _firmwareUpdater = firmwareUpdater;

        _device.PropertyChanged += (_, __) => Refresh();
        _firmwareUpdater.PropertyChanged += (_, __) => Refresh();
        _device.AvailablePorts.CollectionChanged += (_, __) => Refresh();
    }

    public ObservableCollection<DevicePort> AvailablePorts => _device.AvailablePorts;

    private string _statusText = "Disconnected";
    public string StatusText
    {
        get => _statusText;
        set { _statusText = value; OnPropertyChanged(); }
    }

    private string _statusIcon = "cable.connector.slash"; // symbolic mapping for WPF
    public string StatusIcon
    {
        get => _statusIcon;
        set { _statusIcon = value; OnPropertyChanged(); }
    }

    private bool _isConnected;
    public bool IsConnected
    {
        get => _isConnected;
        set { _isConnected = value; OnPropertyChanged(); }
    }

    private string _deviceFirmwareVersion = "";
    public string DeviceFirmwareVersion
    {
        get => _deviceFirmwareVersion;
        set { _deviceFirmwareVersion = value; OnPropertyChanged(); }
    }

    private string _boardType = "";
    public string BoardType
    {
        get => _boardType;
        set { _boardType = value; OnPropertyChanged(); OnPropertyChanged(nameof(IsEspBoard)); OnPropertyChanged(nameof(BoardDisplayName)); }
    }

    public bool IsEspBoard => (BoardType ?? "").ToLowerInvariant() switch
    {
        "esp32" or "esp32s2" or "esp32s3" => true,
        _ => false,
    };

    public string BoardDisplayName => (BoardType ?? "").ToLowerInvariant() switch
    {
        "esp32" => "ESP32",
        "esp32s2" => "ESP32-S2",
        "esp32s3" => "ESP32-S3",
        "stm32f042" => "STM32F042",
        _ => (BoardType ?? "STM32F042").ToUpperInvariant(),
    };

    private string _transportKind = "";
    public string TransportKind
    {
        get => _transportKind;
        set { _transportKind = value; OnPropertyChanged(); }
    }

    private bool _dfuConnected;
    public bool DfuConnected
    {
        get => _dfuConnected;
        set { _dfuConnected = value; OnPropertyChanged(); }
    }

    private bool _espBootloaderConnected;
    public bool EspBootloaderConnected
    {
        get => _espBootloaderConnected;
        set { _espBootloaderConnected = value; OnPropertyChanged(); }
    }

    private string? _espBootloaderPort;
    public string? EspBootloaderPort
    {
        get => _espBootloaderPort;
        set { _espBootloaderPort = value; OnPropertyChanged(); }
    }

    // --- Wi-Fi provisioning state ---

    private string _wifiSSID = "";
    public string WifiSSID
    {
        get => _wifiSSID;
        set { _wifiSSID = value; OnPropertyChanged(); }
    }

    private string _wifiPassword = "";
    public string WifiPassword
    {
        get => _wifiPassword;
        set { _wifiPassword = value; OnPropertyChanged(); }
    }

    private string _wifiProvisioningStatus = "";
    public string WifiProvisioningStatus
    {
        get => _wifiProvisioningStatus;
        set { _wifiProvisioningStatus = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasWifiStatus)); }
    }

    public bool HasWifiStatus => !string.IsNullOrWhiteSpace(_wifiProvisioningStatus);

    private bool _isWifiProvisioning;
    public bool IsWifiProvisioning
    {
        get => _isWifiProvisioning;
        set { _isWifiProvisioning = value; OnPropertyChanged(); }
    }

    private bool _isWifiProvisioningError;
    public bool IsWifiProvisioningError
    {
        get => _isWifiProvisioningError;
        set { _isWifiProvisioningError = value; OnPropertyChanged(); }
    }

    // --- Commands ---

    public ICommand ConnectCommand => new RelayCommand(param =>
    {
        if (param is DevicePort port) _ = _device.ConnectAsync(port);
    });

    public ICommand RefreshCommand => new RelayCommand(async _ =>
    {
        await _device.RefreshPortsAsync();
        await _firmwareUpdater.RefreshDfuPresenceAsync();
    });

    public ICommand DisconnectCommand => new RelayCommand(_ => _device.Disconnect());

    public ICommand OpenFirmwareUpdateCommand => new RelayCommand(_ =>
        OpenFirmwareUpdateRequested?.Invoke());

    public ICommand SendWifiSetupCommand => new RelayCommand(async _ =>
    {
        await _device.ProvisionWiFiAsync(WifiSSID, WifiPassword);
    });

    public ICommand ClearWifiSetupCommand => new RelayCommand(async _ =>
    {
        await _device.ClearWiFiProvisioningAsync();
    });

    public ICommand RefreshWifiStatusCommand => new RelayCommand(async _ =>
    {
        await _device.RefreshWiFiProvisioningStatusAsync();
    });

    public ICommand CloseCommand => new RelayCommand(_ => CloseRequested?.Invoke());

    public event Action? OpenFirmwareUpdateRequested;
    public event Action? CloseRequested;

    private void Refresh()
    {
        IsConnected = _device.IsConnected;
        DfuConnected = _device.DfuConnected;
        EspBootloaderConnected = _firmwareUpdater.EspBootloaderConnected;
        EspBootloaderPort = _firmwareUpdater.EspBootloaderPort;
        DeviceFirmwareVersion = _device.DeviceEmwaverVersion ?? "";

        var boardType = _device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "stm32f042";
        BoardType = boardType;

        if (IsConnected)
        {
            StatusText = "Connected";
            StatusIcon = "cable.connector";
            TransportKind = "USB";
        }
        else if (EspBootloaderConnected)
        {
            StatusText = "ESP Bootloader";
            StatusIcon = "cpu";
        }
        else if (DfuConnected)
        {
            StatusText = "Update Mode";
            StatusIcon = "arrow.triangle.2.circlepath";
        }
        else
        {
            StatusText = "Disconnected";
            StatusIcon = "cable.connector.slash";
        }

        // Reflect Wi-Fi provisioning state
        WifiProvisioningStatus = _device.WiFiProvisioningStatus ?? "";
        IsWifiProvisioning = _device.IsWiFiProvisioning;
        IsWifiProvisioningError = _device.IsWiFiProvisioningError;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
