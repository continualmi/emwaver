using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using EMWaver.Models;
using EMWaver.Services;

namespace EMWaver.Views;

public partial class DeviceConnectionWindow : Window
{
    private readonly WindowsDeviceManager _device;
    private readonly FirmwareUpdateManager _updater;
    private readonly DispatcherTimer _refreshTimer;

    public DeviceConnectionWindow(WindowsDeviceManager device, FirmwareUpdateManager updater)
    {
        InitializeComponent();
        _device = device;
        _updater = updater;

        _device.PropertyChanged += OnDevicePropertyChanged;
        _updater.PropertyChanged += OnFirmwarePropertyChanged;
        _device.AvailablePorts.CollectionChanged += (_, __) => Dispatcher.Invoke(RefreshDeviceList);
        _device.BleDiscoveredDevices.CollectionChanged += (_, __) => Dispatcher.Invoke(RefreshDeviceList);
        _device.WiFiDiscoveredDevices.CollectionChanged += (_, __) => Dispatcher.Invoke(RefreshDeviceList);

        _refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };
        _refreshTimer.Tick += async (_, __) =>
        {
            await _device.RefreshPortsAsync();
            await _updater.RefreshDfuPresenceAsync();
        };

        Closed += (_, __) =>
        {
            _device.PropertyChanged -= OnDevicePropertyChanged;
            _updater.PropertyChanged -= OnFirmwarePropertyChanged;
            _refreshTimer.Stop();
            _device.StopWiFiDiscovery();
        };

        Loaded += async (_, __) =>
        {
            RefreshDeviceList();
            RefreshFirmwareState();
            await _updater.RefreshDfuPresenceAsync();
            _refreshTimer.Start();
            _device.StartBleDiscovery();
            _device.StartWiFiDiscovery();
        };
    }

    private bool IsEspDevice =>
        (_device.ConnectedBoardType ?? _device.LastDetectedBoardType ?? "").StartsWith("esp", StringComparison.OrdinalIgnoreCase);

    private void OnDevicePropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Dispatcher.Invoke(() =>
        {
            RefreshDeviceList();
            RefreshWifiState();
            RefreshFirmwareState();
        });
    }

    private void OnFirmwarePropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Dispatcher.Invoke(RefreshFirmwareState);
    }

    private void RefreshDeviceList()
    {
        var ports = _device.AvailablePorts.ToList();
        var bleDevices = _device.BleDiscoveredDevices.ToList();
        var wifiDevices = _device.WiFiDiscoveredDevices.ToList();

        NoDevicesText.Visibility = ports.Count == 0 && bleDevices.Count == 0 && wifiDevices.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        DeviceList.Items.Clear();
        if (ports.Count > 0)
        {
            AddDeviceSection("USB devices", "Direct local USB connection. Best for setup, flashing, and reliable bench use.");
        }
        foreach (var port in ports)
        {
            var isConnected = _device.IsConnected && _device.ConnectedPort?.DisplayName == port.DisplayName;
            var panel = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };

            var infoText = new TextBlock
            {
                Text = port.DisplayName,
                VerticalAlignment = VerticalAlignment.Center,
                FontSize = 13,
                Margin = new Thickness(0, 0, 12, 0),
            };

            if (isConnected)
            {
                infoText.Text += "  (Connected)";
                infoText.FontWeight = System.Windows.FontWeights.SemiBold;
            }

            DockPanel.SetDock(infoText, Dock.Left);
            panel.Children.Add(infoText);

            if (!isConnected)
            {
                var connectBtn = new Button
                {
                    Content = "Connect",
                    Width = 80,
                    Height = 26,
                    HorizontalAlignment = HorizontalAlignment.Right,
                };
                var capturedPort = port;
                connectBtn.Click += async (_, __) =>
                {
                    await _device.ConnectAsync(capturedPort);
                };
                DockPanel.SetDock(connectBtn, Dock.Right);
                panel.Children.Add(connectBtn);
            }
            else
            {
                var disconnectBtn = new Button
                {
                    Content = "Disconnect",
                    Width = 80,
                    Height = 26,
                    HorizontalAlignment = HorizontalAlignment.Right,
                };
                disconnectBtn.Click += (_, __) => _device.Disconnect();
                DockPanel.SetDock(disconnectBtn, Dock.Right);
                panel.Children.Add(disconnectBtn);
            }

            DeviceList.Items.Add(panel);
        }

        if (bleDevices.Count > 0)
        {
            AddDeviceSection("BLE devices", "Nearby ESP32-class boards discovered over Bluetooth Low Energy.");
        }
        foreach (var ble in bleDevices)
        {
            var isConnected = _device.IsConnected && _device.ActiveTransport == DeviceTransport.Ble && _device.ConnectedPort?.DisplayName == ble.DisplayName;
            DeviceList.Items.Add(MakeDeviceRow(
                $"{ble.DisplayName}  ·  BLE  ·  {DisplayBoard(ble.BoardType)}",
                isConnected,
                async () => await _device.ConnectBleAsync(ble)));
        }

        if (wifiDevices.Count > 0)
        {
            AddDeviceSection("Wi-Fi devices", "Boards discovered on your local network. Use VPN/Tailscale/SSH for user-owned remote access.");
        }
        foreach (var wifi in wifiDevices)
        {
            var isConnected = _device.IsConnected && _device.ActiveTransport == DeviceTransport.Wifi && _device.ConnectedPort?.DisplayName?.Contains(wifi.Host, StringComparison.OrdinalIgnoreCase) == true;
            DeviceList.Items.Add(MakeDeviceRow(
                $"{wifi.DisplayName}  ·  Wi-Fi  ·  {DisplayBoard(wifi.BoardType)}",
                isConnected,
                async () => await _device.ConnectWiFiAsync(wifi.Host, wifi.Port)));
        }

        DeviceList.Visibility = DeviceList.Items.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void AddDeviceSection(string title, string detail)
    {
        DeviceList.Items.Add(new StackPanel
        {
            Margin = new Thickness(0, DeviceList.Items.Count == 0 ? 0 : 10, 0, 6),
            Children =
            {
                new TextBlock
                {
                    Text = title,
                    FontSize = 12,
                    FontWeight = FontWeights.SemiBold,
                },
                new TextBlock
                {
                    Text = detail,
                    FontSize = 11,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = FindResource("AppTextSecondaryBrush") as System.Windows.Media.Brush,
                }
            }
        });
    }

    private static string DisplayBoard(string? boardType)
    {
        return (boardType ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "esp32s3" => "ESP32-S3",
            "esp32s2" => "ESP32-S2",
            "esp32" => "ESP32",
            "stm32f042" => "STM32F042",
            "" => "Unknown",
            var other => other.ToUpperInvariant(),
        };
    }

    private UIElement MakeDeviceRow(string text, bool isConnected, Func<Task> connectAction)
    {
        var panel = new DockPanel { Margin = new Thickness(0, 0, 0, 6) };
        var infoText = new TextBlock
        {
            Text = isConnected ? text + "  (Connected)" : text,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 13,
            Margin = new Thickness(0, 0, 12, 0),
            FontWeight = isConnected ? FontWeights.SemiBold : FontWeights.Normal,
        };
        DockPanel.SetDock(infoText, Dock.Left);
        panel.Children.Add(infoText);

        var button = new Button
        {
            Content = isConnected ? "Disconnect" : "Use",
            Width = 80,
            Height = 26,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        button.Click += async (_, __) =>
        {
            if (isConnected) _device.Disconnect();
            else await connectAction();
        };
        DockPanel.SetDock(button, Dock.Right);
        panel.Children.Add(button);
        return panel;
    }

    private void RefreshWifiState()
    {
        WifiCard.Visibility = IsEspDevice ? Visibility.Visible : Visibility.Collapsed;

        // Update status
        if (!string.IsNullOrWhiteSpace(_device.WiFiProvisioningStatus))
        {
            WifiStatusText.Text = _device.WiFiProvisioningStatus;
            WifiStatusText.Foreground = _device.IsWiFiProvisioningError
                ? FindResource("AppErrorTextBrush") as System.Windows.Media.Brush
                : System.Windows.SystemColors.GrayTextBrush;
            WifiStatusText.Visibility = Visibility.Visible;
        }

        WifiSendButton.IsEnabled = _device.IsConnected && !_device.IsWiFiProvisioning;
    }

    private void RefreshFirmwareState()
    {
        var isEsp = IsEspDevice ||
                    _updater.EspBootloaderConnected ||
                    !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort) ||
                    !_device.IsConnected;

        FirmwareDescText.Text = isEsp
            ? "Flash bundled ESP32 firmware over the board's serial bootloader. No prior app connection required."
            : "Update the connected board firmware.";

        FirmwareButton.Content = isEsp ? "Flash firmware" : "Update firmware";

        // Keep firmware flashing reachable even while the app is only scanning.
        // A blank ESP32 board cannot be connected to the app before firmware exists.
        FirmwareButton.IsEnabled = true;
    }

    private async void OnWifiSendClick(object sender, RoutedEventArgs e)
    {
        var ssid = WifiSSIDBox.Text.Trim();
        var password = WifiPasswordBox.Password;

        if (string.IsNullOrWhiteSpace(ssid))
        {
            WifiStatusText.Text = "SSID is required.";
            WifiStatusText.Foreground = FindResource("AppErrorTextBrush") as System.Windows.Media.Brush;
            WifiStatusText.Visibility = Visibility.Visible;
            return;
        }

        await _device.ProvisionWiFiAsync(ssid, password);
    }

    private async void OnWifiClearClick(object sender, RoutedEventArgs e)
    {
        await _device.ClearWiFiProvisioningAsync();
    }

    private async void OnWifiStatusClick(object sender, RoutedEventArgs e)
    {
        await _device.RefreshWiFiProvisioningStatusAsync();
    }

    private void OnFirmwareClick(object sender, RoutedEventArgs e)
    {
        var boardType = _device.ConnectedBoardType ?? _device.LastDetectedBoardType;
        if (string.IsNullOrWhiteSpace(boardType) &&
            (_updater.EspBootloaderConnected || !string.IsNullOrWhiteSpace(_updater.EspBootloaderPort) || !_device.IsConnected))
        {
            boardType = "esp32s3";
        }
        var fwWindow = new FirmwareUpdateWindow(_device, _updater, boardType)
        {
            Owner = this,
        };
        fwWindow.ShowDialog();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => Close();
}
