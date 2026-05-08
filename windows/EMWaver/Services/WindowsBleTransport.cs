using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Foundation;
using Windows.Storage.Streams;

namespace EMWaver.Services;

internal static class WindowsBleTransport
{
    internal static readonly Guid ServiceUuid = Guid.Parse("45C7158E-0C3B-4E90-A847-452A15B14191");
    internal static readonly Guid CommandUuid = Guid.Parse("46C7158E-0C3B-4E90-A847-452A15B14191");
    internal static readonly Guid NotifyUuid = Guid.Parse("47C7158E-0C3B-4E90-A847-452A15B14191");

    internal const int WriteChunkBytes = 20;

    internal static string SessionId(ulong bluetoothAddress) => $"ble:{bluetoothAddress:X}";

    internal static BluetoothLEAdvertisementWatcher CreateWatcher(
        TypedEventHandler<BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementReceivedEventArgs> receivedHandler)
    {
        var watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active
        };
        watcher.AdvertisementFilter.Advertisement.ServiceUuids.Add(ServiceUuid);
        watcher.Received += receivedHandler;
        return watcher;
    }

    internal static bool MatchesAdvertisementName(string name)
    {
        return string.IsNullOrWhiteSpace(name) ||
               name.Contains("emwaver", StringComparison.OrdinalIgnoreCase);
    }

    internal static async Task<BluetoothLEDevice?> OpenDeviceAsync(ulong bluetoothAddress)
    {
        return await BluetoothLEDevice.FromBluetoothAddressAsync(bluetoothAddress);
    }

    internal static async Task<GattDeviceService?> FindServiceAsync(BluetoothLEDevice device)
    {
        var servicesResult = await device.GetGattServicesForUuidAsync(ServiceUuid, BluetoothCacheMode.Uncached);
        if (servicesResult.Status != GattCommunicationStatus.Success || servicesResult.Services.Count == 0)
        {
            return null;
        }
        return servicesResult.Services[0];
    }

    internal static async Task<GattCharacteristic?> FindCommandCharacteristicAsync(GattDeviceService service)
    {
        var commandResult = await service.GetCharacteristicsForUuidAsync(CommandUuid, BluetoothCacheMode.Uncached);
        if (commandResult.Status != GattCommunicationStatus.Success || commandResult.Characteristics.Count == 0)
        {
            return null;
        }
        return commandResult.Characteristics[0];
    }

    internal static async Task<GattCharacteristic?> FindNotifyCharacteristicAsync(GattDeviceService service)
    {
        var notifyResult = await service.GetCharacteristicsForUuidAsync(NotifyUuid, BluetoothCacheMode.Uncached);
        if (notifyResult.Status != GattCommunicationStatus.Success || notifyResult.Characteristics.Count == 0)
        {
            return null;
        }
        return notifyResult.Characteristics[0];
    }

    internal static async Task EnableNotificationsAsync(GattCharacteristic? characteristic)
    {
        if (characteristic == null)
        {
            return;
        }
        await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
            GattClientCharacteristicConfigurationDescriptorValue.Notify);
    }

    internal static string? SendSuperframe(
        GattCharacteristic characteristic,
        byte[] superframe36,
        Func<byte[], IBuffer> bufferFromBytes)
    {
        var sysex = UsbMidiSysex.EncodeSuperframe(superframe36);
        if (sysex == null)
        {
            return "SysEx encode failed";
        }

        Debug.WriteLine($"[EMWaver][BLE][TX] superframe36={superframe36.Length} sysex={sysex.Length} cmd0=0x{superframe36[0]:X2}");

        for (int offset = 0; offset < sysex.Length; offset += WriteChunkBytes)
        {
            var count = Math.Min(WriteChunkBytes, sysex.Length - offset);
            var chunk = new byte[count];
            System.Buffer.BlockCopy(sysex, offset, chunk, 0, count);
            var status = characteristic
                .WriteValueAsync(bufferFromBytes(chunk), GattWriteOption.WriteWithResponse)
                .AsTask()
                .GetAwaiter()
                .GetResult();
            if (status != GattCommunicationStatus.Success)
            {
                return $"BLE write failed: {status}";
            }
        }

        return null;
    }
}
