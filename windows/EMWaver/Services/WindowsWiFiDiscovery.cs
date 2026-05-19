using System;
using System.Collections.Generic;
using System.Linq;
using Windows.Devices.Enumeration;

namespace EMWaver.Services;

internal sealed class WindowsWiFiDiscovery : IDisposable
{
    private const string DnssdProtocolId = "{4526e8c1-8aac-4153-9b16-55e86ada0e54}";
    private static readonly string Selector =
        $"System.Devices.AepService.ProtocolId:=\"{DnssdProtocolId}\" " +
        $"AND System.Devices.Dnssd.ServiceName:=\"{WindowsWiFiTransport.ServiceType}\" " +
        "AND System.Devices.Dnssd.Domain:=\"local\"";
    private static readonly string[] RequestedProperties =
    {
        "System.Devices.IpAddress",
        "System.Devices.Dnssd.HostName",
        "System.Devices.Dnssd.InstanceName",
        "System.Devices.Dnssd.PortNumber",
        "System.Devices.Dnssd.ServiceName",
        "System.Devices.Dnssd.TextAttributes",
    };

    private readonly Dictionary<string, WindowsWiFiTransport.DiscoveredDevice> _devicesByWatcherId = new(StringComparer.OrdinalIgnoreCase);
    private DeviceWatcher? _watcher;
    private Action<IReadOnlyList<WindowsWiFiTransport.DiscoveredDevice>>? _onChanged;
    private Action<string>? _onError;

    internal void Start(
        Action<IReadOnlyList<WindowsWiFiTransport.DiscoveredDevice>> onChanged,
        Action<string> onError)
    {
        Stop(clearDevices: false);
        _onChanged = onChanged;
        _onError = onError;
        _watcher = DeviceInformation.CreateWatcher(
            Selector,
            RequestedProperties,
            DeviceInformationKind.AssociationEndpointService);
        _watcher.Added += OnAdded;
        _watcher.Updated += OnUpdated;
        _watcher.Removed += OnRemoved;
        _watcher.EnumerationCompleted += OnEnumerationCompleted;
        _watcher.Stopped += OnStopped;
        _watcher.Start();
        Publish();
    }

    internal void Stop(bool clearDevices)
    {
        if (_watcher != null)
        {
            _watcher.Added -= OnAdded;
            _watcher.Updated -= OnUpdated;
            _watcher.Removed -= OnRemoved;
            _watcher.EnumerationCompleted -= OnEnumerationCompleted;
            _watcher.Stopped -= OnStopped;
            if (_watcher.Status is DeviceWatcherStatus.Started or DeviceWatcherStatus.EnumerationCompleted)
            {
                _watcher.Stop();
            }
            _watcher = null;
        }

        if (clearDevices)
        {
            _devicesByWatcherId.Clear();
        }
        Publish();
    }

    public void Dispose() => Stop(clearDevices: true);

    private void OnAdded(DeviceWatcher sender, DeviceInformation args)
    {
        AddOrUpdate(args.Id, args.Properties);
    }

    private void OnUpdated(DeviceWatcher sender, DeviceInformationUpdate args)
    {
        AddOrUpdate(args.Id, args.Properties);
    }

    private void OnRemoved(DeviceWatcher sender, DeviceInformationUpdate args)
    {
        if (_devicesByWatcherId.Remove(args.Id))
        {
            Publish();
        }
    }

    private void OnEnumerationCompleted(DeviceWatcher sender, object args) => Publish();

    private void OnStopped(DeviceWatcher sender, object args) => Publish();

    private void AddOrUpdate(string watcherId, IReadOnlyDictionary<string, object> properties)
    {
        var instanceName = FirstString(properties, "System.Devices.Dnssd.InstanceName") ?? "EMWaver";
        var hostName = FirstString(properties, "System.Devices.Dnssd.HostName")
            ?? FirstString(properties, "System.Devices.IpAddress");
        var port = FirstUInt16(properties, "System.Devices.Dnssd.PortNumber") ?? WindowsWiFiTransport.DefaultPort;
        var metadata = WindowsWiFiTransport.ParseTextAttributes(
            properties.TryGetValue("System.Devices.Dnssd.TextAttributes", out var textAttributes) ? textAttributes : null);
        var device = WindowsWiFiTransport.DiscoveredDeviceFromDnsSd(instanceName, hostName, port, metadata);
        if (device == null)
        {
            _onError?.Invoke("Discovered Wi-Fi device did not include a usable host.");
            return;
        }
        _devicesByWatcherId[watcherId] = device;
        Publish();
    }

    private void Publish()
    {
        var devices = _devicesByWatcherId.Values
            .GroupBy(device => device.Id, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderBy(device => device.DisplayName, StringComparer.OrdinalIgnoreCase).First())
            .OrderBy(device => device.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        _onChanged?.Invoke(devices);
    }

    private static string? FirstString(IReadOnlyDictionary<string, object> properties, string key)
    {
        if (!properties.TryGetValue(key, out var value) || value == null)
        {
            return null;
        }
        if (value is string text)
        {
            return text;
        }
        if (value is IEnumerable<string> strings)
        {
            return strings.FirstOrDefault(item => !string.IsNullOrWhiteSpace(item));
        }
        return value.ToString();
    }

    private static int? FirstUInt16(IReadOnlyDictionary<string, object> properties, string key)
    {
        if (!properties.TryGetValue(key, out var value) || value == null)
        {
            return null;
        }
        if (value is ushort ushortValue)
        {
            return ushortValue;
        }
        if (value is int intValue)
        {
            return intValue;
        }
        return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }
}
