using EMWaver.Models;
using EMWaver.Interop;
using Microsoft.UI.Dispatching;
using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Devices.Midi;
using Windows.Devices.Usb;
using Windows.Storage.Streams;
using System.Diagnostics;

namespace EMWaver.Services;

internal enum DeviceMode
{
    Disconnected = 0,
    RunMode = 1,
    UpdateMode = 2,
}

internal enum DeviceTransport
{
    None = 0,
    UsbMidi = 1,
    Ble = 2,
}

internal sealed class WindowsDeviceManager : INotifyPropertyChanged
{
    private static readonly int LaneSizeBytes = 18;
    private static readonly int SuperframeSizeBytes = 36;
    private static class EmwOpcode
    {
        internal const byte Version = 0x01;
        internal const byte EnterDfu = 0x06;
    }

    public ObservableCollection<DevicePort> AvailablePorts { get; } = new();

    private DevicePort? _connectedPort;
    public DevicePort? ConnectedPort
    {
        get => _connectedPort;
        private set
        {
            if (!Equals(_connectedPort, value))
            {
                _connectedPort = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(IsConnected));
            }
        }
    }

    public bool IsConnected => ConnectedPort != null;

    private DeviceTransport _activeTransport = DeviceTransport.None;
    public DeviceTransport ActiveTransport
    {
        get => _activeTransport;
        private set
        {
            if (_activeTransport != value)
            {
                _activeTransport = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _deviceEmwaverVersion;
    public string? DeviceEmwaverVersion
    {
        get => _deviceEmwaverVersion;
        private set
        {
            if (_deviceEmwaverVersion != value)
            {
                _deviceEmwaverVersion = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _connectedBoardType;
    public string? ConnectedBoardType
    {
        get => _connectedBoardType;
        private set
        {
            if (_connectedBoardType != value)
            {
                _connectedBoardType = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _lastDetectedBoardType;
    public string? LastDetectedBoardType
    {
        get => _lastDetectedBoardType;
        internal set
        {
            if (_lastDetectedBoardType != value)
            {
                _lastDetectedBoardType = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _lastErrorText;
    public string? LastErrorText
    {
        get => _lastErrorText;
        private set
        {
            if (_lastErrorText != value)
            {
                _lastErrorText = value;
                OnPropertyChanged();
            }
        }
    }

    private bool _autoConnectEnabled = true;
    public bool AutoConnectEnabled
    {
        get => _autoConnectEnabled;
        set
        {
            if (_autoConnectEnabled != value)
            {
                _autoConnectEnabled = value;
                OnPropertyChanged();
                if (_autoConnectEnabled)
                {
                    _ = RefreshPortsAsync();
                }
            }
        }
    }

    private bool _dfuConnected;
    public bool DfuConnected
    {
        get => _dfuConnected;
        private set
        {
            if (_dfuConnected != value)
            {
                _dfuConnected = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(Mode));
            }
        }
    }

    public DeviceMode Mode
    {
        get
        {
            if (IsConnected) return DeviceMode.RunMode;
            if (DfuConnected) return DeviceMode.UpdateMode;
            return DeviceMode.Disconnected;
        }
    }

    private DispatcherQueue? _ui;

    private MidiInPort? _inPort;
    private IMidiOutPort? _outPort;
    private BluetoothLEAdvertisementWatcher? _bleWatcher;
    private BluetoothLEDevice? _bleDevice;
    private GattCharacteristic? _bleCommandCharacteristic;
    private GattCharacteristic? _bleNotifyCharacteristic;
    private bool _bleConnecting;
    private string? _connectedUsbSessionId;
    private string? _connectedBleSessionId;
    private readonly object _bufferSessionLock = new();
    private readonly Dictionary<string, ITransportDeviceSession> _bufferSessionsByDeviceId = new(StringComparer.OrdinalIgnoreCase);
    private ITransportDeviceSession _activeBufferSession = new DeviceBufferSession("active");

    private ITransportDeviceSession ActiveBufferSession
    {
        get
        {
            lock (_bufferSessionLock)
            {
                return _activeBufferSession;
            }
        }
    }

    internal byte[] GetActiveRxSnapshot() => ActiveBufferSession.GetRxSnapshot();
    internal void ClearActiveBuffer() => ActiveBufferSession.ClearAll();
    internal ulong GetActiveRxPacketCount() => ActiveBufferSession.GetRxPacketCount();
    internal ulong GetActiveTxPacketCount() => ActiveBufferSession.GetTxPacketCount();
    internal string ActiveBufferSessionId => ActiveBufferSession.DeviceId;

    internal byte[] GetRxSnapshot(string deviceId) => BufferSession(deviceId).GetRxSnapshot();
    internal void ClearBuffer(string deviceId) => BufferSession(deviceId).ClearAll();

    private ITransportDeviceSession BufferSession(string deviceId)
    {
        var key = string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId;
        lock (_bufferSessionLock)
        {
            if (!_bufferSessionsByDeviceId.TryGetValue(key, out var session))
            {
                session = new DeviceBufferSession(key);
                _bufferSessionsByDeviceId[key] = session;
            }

            return session;
        }
    }

    private void SetActiveBufferSession(string deviceId)
    {
        lock (_bufferSessionLock)
        {
            var session = BufferSession(deviceId);
            _activeBufferSession = session;
            _activeBufferSession.ClearAll();
        }
    }

    internal void AttachUiDispatcher(DispatcherQueue dispatcherQueue)
    {
        _ui = dispatcherQueue;
    }

    private void RunOnUi(Action action)
    {
        var ui = _ui;
        if (ui == null)
        {
            action();
            return;
        }
        _ = ui.TryEnqueue(() => action());
    }

    internal async Task RefreshPortsAsync()
    {
        try
        {
            LastErrorText = null;

            var inDevsTask = DeviceInformation.FindAllAsync(
                MidiInPort.GetDeviceSelector(),
                WindowsUsbMidiTransport.ContainerProperties
            ).AsTask();
            var outDevsTask = DeviceInformation.FindAllAsync(
                MidiOutPort.GetDeviceSelector(),
                WindowsUsbMidiTransport.ContainerProperties
            ).AsTask();
            var dfuTask = IsDfuPresentAsync();

            await Task.WhenAll(inDevsTask, outDevsTask, dfuTask);

            var pairs = WindowsUsbMidiTransport.PairPorts(inDevsTask.Result, outDevsTask.Result);

            RunOnUi(() =>
            {
                AvailablePorts.Clear();
                foreach (var p in pairs) AvailablePorts.Add(p);
            });

            DfuConnected = dfuTask.Result;

            if (AutoConnectEnabled && !IsConnected)
            {
                var chosen = WindowsUsbMidiTransport.ChoosePreferred(pairs);
                if (chosen != null)
                {
                    await ConnectAsync(chosen);
                }
                else
                {
                    StartBleScan();
                }
            }
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    internal async Task ConnectAsync(DevicePort port)
    {
        Disconnect();

        try
        {
            LastErrorText = null;
            DeviceEmwaverVersion = null;
            ConnectedBoardType = null;

            // Keep parity with iOS/macOS: clear shared buffer state on connect.
            _connectedUsbSessionId = WindowsUsbMidiTransport.SessionId(port);
            _connectedBleSessionId = null;
            SetActiveBufferSession(_connectedUsbSessionId);

            _inPort = await MidiInPort.FromIdAsync(port.InDeviceId);
            _outPort = await MidiOutPort.FromIdAsync(port.OutDeviceId);

            if (_inPort == null || _outPort == null)
            {
                Disconnect();
                LastErrorText = "Failed to open MIDI ports";
                return;
            }

            _inPort.MessageReceived += OnMidiMessage;
            ActiveTransport = DeviceTransport.UsbMidi;
            ConnectedPort = port;

            // Validate the device by querying its EMWaver version (same handshake as macOS).
            var version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            if (version == null)
            {
                await Task.Delay(250);
                version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            }

            if (version == null)
            {
                LastErrorText = "Connected port did not respond like an EMWaver device";
                Disconnect();
                return;
            }

            DeviceEmwaverVersion = version;

            _ = Task.Run(async () =>
            {
                try
                {
                    var boardType = InferBoardType(port.DisplayName);
                    RunOnUi(() =>
                    {
                        ConnectedBoardType = boardType;
                        LastDetectedBoardType = boardType;
                    });
                }
                catch
                {
                    RunOnUi(() =>
                    {
                        ConnectedBoardType = InferBoardType(port.DisplayName);
                        LastDetectedBoardType = ConnectedBoardType;
                    });
                }
            });
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            Disconnect();
        }
    }

    internal void Disconnect()
    {
        StopBleScan();

        try
        {
            if (_inPort != null)
            {
                _inPort.MessageReceived -= OnMidiMessage;
                _inPort.Dispose();
            }
        }
        catch
        {
            // Ignore dispose errors.
        }
        finally
        {
            _inPort = null;
        }

        try
        {
            _outPort?.Dispose();
        }
        catch
        {
            // Ignore dispose errors.
        }
        finally
        {
            _outPort = null;
        }

        CloseBleDevice();

        ActiveBufferSession.CancelResponseWait();
        _connectedUsbSessionId = null;
        _connectedBleSessionId = null;

        ConnectedPort = null;
        ActiveTransport = DeviceTransport.None;
        DeviceEmwaverVersion = null;
        ConnectedBoardType = null;

        // Keep parity with iOS/macOS: avoid stale capture across sessions.
        ActiveBufferSession.ClearAll();
    }

    internal void RequestEnterUpdateMode()
    {
        // Fire-and-forget: device will reboot into STM32 ROM DFU (0483:DF11).
        try
        {
            if (_outPort == null)
            {
                LastErrorText = "Cannot enter Update Mode: Not connected";
                return;
            }

            var pkt = MakeLanePacket(stackalloc byte[] { EmwOpcode.EnterDfu });
            var sf = MakeSuperframe(cmdLane: pkt, streamLane: null);
            SendSuperframe(sf);
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    internal async Task RefreshDfuPresenceAsync()
    {
        try
        {
            DfuConnected = await IsDfuPresentAsync();
        }
        catch
        {
            DfuConnected = false;
        }
    }

    private static string InferBoardType(string? portName)
    {
        var name = (portName ?? string.Empty).ToLowerInvariant();
        if (name.Contains("esp32") || name.Contains("esp 32") || name.Contains("s3"))
        {
            return "esp32s3";
        }
        if (name.Contains("emwaver esp"))
        {
            return "esp32s3";
        }
        return "stm32f042";
    }

    private async Task<string?> QueryDeviceVersionAsync(int timeoutMs)
    {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, 0...]
        var resp = await SendCommandAsync(
            commandLane: new byte[] { EmwOpcode.Version },
            timeoutMs: timeoutMs,
            responsePredicate: lane18 =>
            {
                if (lane18.Length < 3) return false;
                if (lane18[0] != 0x80) return false;
                for (int i = 3; i < lane18.Length; i++)
                {
                    if (lane18[i] != 0) return false;
                }
                return true;
            }
        );

        if (resp == null || resp.Length < 3 || resp[0] != 0x80)
        {
            return null;
        }

        return $"{resp[1]}.{resp[2]}";
    }

    private async Task<byte[]?> SendCommandAsync(byte[] commandLane, int timeoutMs, Func<byte[], bool> responsePredicate)
    {
        return await SendCommandAsync(commandLane, timeoutMs, ActiveBufferSession, responsePredicate);
    }

    private async Task<byte[]?> SendCommandAsync(
        byte[] commandLane,
        int timeoutMs,
        ITransportDeviceSession session,
        Func<byte[], bool> responsePredicate)
    {
        if (ActiveTransport == DeviceTransport.Ble)
        {
            if (_bleCommandCharacteristic == null)
            {
                LastErrorText = "Cannot send command: BLE not connected";
                return null;
            }
        }
        else if (_outPort == null || _inPort == null)
        {
            LastErrorText = "Cannot send command: Not connected";
            return null;
        }

        var tcs = session.BeginResponseWait(responsePredicate);

        using var cts = new CancellationTokenSource(Math.Max(1, timeoutMs));
        using var reg = cts.Token.Register(() => tcs.TrySetResult(null));
        try
        {
            var pkt = MakeLanePacket(commandLane);
            var sf = MakeSuperframe(cmdLane: pkt, streamLane: null);
            SendSuperframe(sf);
            return await tcs.Task;
        }
        finally
        {
            session.ClearResponseWait(tcs);
        }
    }

    private void OnMidiMessage(MidiInPort sender, MidiMessageReceivedEventArgs args)
    {
        try
        {
            if (args.Message.Type != MidiMessageType.SystemExclusive)
            {
                return;
            }

            if (args.Message is not MidiSystemExclusiveMessage sx)
            {
                return;
            }

            var bytes = BufferFromIbuffer(sx.RawData);
            if (bytes == null)
            {
                Debug.WriteLine("[EMWaver][MIDI][RX] sysEx rawData decode failed (null)");
                return;
            }

            ProcessIncomingSysex(bytes, "MIDI", _connectedUsbSessionId);
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
    }

    private void ProcessIncomingSysex(byte[] bytes, string transportLabel, string? deviceId = null)
    {
        Debug.WriteLine($"[EMWaver][{transportLabel}][RX] sysex={bytes.Length}");
        var session = string.IsNullOrWhiteSpace(deviceId)
            ? ActiveBufferSession
            : BufferSession(deviceId);
        session.FeedSysexBytes(bytes, NowMs());
    }

    internal byte[]? SendPacket(byte[] payload, int timeoutMs)
    {
        try
        {
            return SendPacketAsync(payload, timeoutMs).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            return null;
        }
    }

    internal async Task<byte[]?> SendPacketAsync(byte[] payload, int timeoutMs)
    {
        return await SendPacketAsync(payload, timeoutMs, ActiveBufferSession.DeviceId);
    }

    internal byte[]? SendPacket(byte[] payload, int timeoutMs, string deviceId)
    {
        try
        {
            return SendPacketAsync(payload, timeoutMs, deviceId).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            return null;
        }
    }

    internal async Task<byte[]?> SendPacketAsync(byte[] payload, int timeoutMs, string deviceId)
    {
        if (payload == null)
        {
            return null;
        }

        // Protocol rule: requests must fit within a single 18-byte command lane.
        if (payload.Length > LaneSizeBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(payload), $"Packet too large (max {LaneSizeBytes})");
        }

        return await SendCommandAsync(
            commandLane: payload,
            timeoutMs: timeoutMs,
            session: BufferSession(deviceId),
            responsePredicate: lane18 => lane18.Length > 0 && (lane18[0] == 0x80 || lane18[0] == 0x81)
        );
    }

    private void SendSuperframe(byte[] superframe36)
    {
        if (ActiveTransport == DeviceTransport.Ble)
        {
            SendBleSuperframe(superframe36);
            return;
        }

        if (_outPort == null)
        {
            LastErrorText = "Cannot send: Not connected";
            return;
        }

        // Log TX for buffer parity/debugging (Rust buffer core chunks to 18B packets).
        ActiveBufferSession.AppendTxBytes(superframe36, NowMs());

        LastErrorText = WindowsUsbMidiTransport.SendSuperframe(_outPort, superframe36, BufferFromBytes);
    }

    private void StartBleScan()
    {
        if (_bleWatcher != null || _bleConnecting || IsConnected)
        {
            return;
        }

        try
        {
            var watcher = WindowsBleTransport.CreateWatcher(OnBleAdvertisementReceived);
            _bleWatcher = watcher;
            watcher.Start();
            Debug.WriteLine("[EMWaver][BLE] scan started");
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    private void StopBleScan()
    {
        var watcher = _bleWatcher;
        if (watcher == null)
        {
            return;
        }

        try
        {
            watcher.Received -= OnBleAdvertisementReceived;
            watcher.Stop();
        }
        catch
        {
            // Ignore watcher shutdown errors.
        }
        finally
        {
            _bleWatcher = null;
        }
    }

    private void OnBleAdvertisementReceived(BluetoothLEAdvertisementWatcher sender, BluetoothLEAdvertisementReceivedEventArgs args)
    {
        if (_bleConnecting || IsConnected)
        {
            return;
        }

        var name = args.Advertisement.LocalName ?? string.Empty;
        if (!WindowsBleTransport.MatchesAdvertisementName(name))
        {
            return;
        }

        _bleConnecting = true;
        StopBleScan();
        _ = ConnectBleAsync(args.BluetoothAddress, string.IsNullOrWhiteSpace(name) ? "EMWaver BLE" : name);
    }

    private async Task ConnectBleAsync(ulong bluetoothAddress, string displayName)
    {
        try
        {
            LastErrorText = null;
            DeviceEmwaverVersion = null;
            ConnectedBoardType = null;
            _connectedBleSessionId = WindowsBleTransport.SessionId(bluetoothAddress);
            _connectedUsbSessionId = null;
            SetActiveBufferSession(_connectedBleSessionId);

            CloseBleDevice();

            var device = await WindowsBleTransport.OpenDeviceAsync(bluetoothAddress);
            if (device == null)
            {
                LastErrorText = "Failed to open BLE device";
                return;
            }

            var service = await WindowsBleTransport.FindServiceAsync(device);
            if (service == null)
            {
                device.Dispose();
                LastErrorText = "BLE EMWaver service not found";
                return;
            }

            var commandCharacteristic = await WindowsBleTransport.FindCommandCharacteristicAsync(service);
            if (commandCharacteristic == null)
            {
                device.Dispose();
                LastErrorText = "BLE command characteristic not found";
                return;
            }

            _bleDevice = device;
            _bleCommandCharacteristic = commandCharacteristic;

            var notifyCharacteristic = await WindowsBleTransport.FindNotifyCharacteristicAsync(service);
            if (notifyCharacteristic != null)
            {
                _bleNotifyCharacteristic = notifyCharacteristic;
                _bleNotifyCharacteristic.ValueChanged += OnBleValueChanged;
                await WindowsBleTransport.EnableNotificationsAsync(_bleNotifyCharacteristic);
            }

            ActiveTransport = DeviceTransport.Ble;
            ConnectedPort = new DevicePort(displayName, string.Empty, string.Empty);

            var version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            if (version == null)
            {
                await Task.Delay(250);
                version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            }

            DeviceEmwaverVersion = version;
            ConnectedBoardType = "esp32s3";
            LastDetectedBoardType = ConnectedBoardType;
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            Disconnect();
        }
        finally
        {
            _bleConnecting = false;
        }
    }

    private async void OnBleValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var bytes = BufferFromIbuffer(args.CharacteristicValue);
            if (bytes != null)
            {
                ProcessIncomingSysex(bytes, "BLE", _connectedBleSessionId);
            }
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
    }

    private void SendBleSuperframe(byte[] superframe36)
    {
        var characteristic = _bleCommandCharacteristic;
        if (characteristic == null)
        {
            LastErrorText = "Cannot send: BLE not connected";
            return;
        }

        ActiveBufferSession.AppendTxBytes(superframe36, NowMs());
        LastErrorText = WindowsBleTransport.SendSuperframe(characteristic, superframe36, BufferFromBytes);
    }

    private void CloseBleDevice()
    {
        try
        {
            if (_bleNotifyCharacteristic != null)
            {
                _bleNotifyCharacteristic.ValueChanged -= OnBleValueChanged;
            }
        }
        catch
        {
            // Ignore dispose errors.
        }

        try
        {
            _bleDevice?.Dispose();
        }
        catch
        {
            // Ignore dispose errors.
        }
        finally
        {
            _bleNotifyCharacteristic = null;
            _bleCommandCharacteristic = null;
            _bleDevice = null;
            _bleConnecting = false;
        }
    }

    private static ulong NowMs()
    {
        return (ulong)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static byte[] MakeLanePacket(ReadOnlySpan<byte> laneBytes)
    {
        if (laneBytes.Length > LaneSizeBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(laneBytes), $"Lane too large (max {LaneSizeBytes})");
        }

        var outBytes = new byte[LaneSizeBytes];
        laneBytes.CopyTo(outBytes);
        return outBytes;
    }

    private static byte[] MakeSuperframe(byte[]? cmdLane, byte[]? streamLane)
    {
        var sf = new byte[SuperframeSizeBytes];
        if (cmdLane != null)
        {
            System.Buffer.BlockCopy(cmdLane, 0, sf, 0, Math.Min(cmdLane.Length, LaneSizeBytes));
        }
        if (streamLane != null)
        {
            System.Buffer.BlockCopy(streamLane, 0, sf, LaneSizeBytes, Math.Min(streamLane.Length, LaneSizeBytes));
        }
        return sf;
    }

    private static IBuffer BufferFromBytes(byte[] bytes)
    {
        var writer = new DataWriter();
        writer.WriteBytes(bytes);
        return writer.DetachBuffer();
    }

    private static byte[]? BufferFromIbuffer(IBuffer buffer)
    {
        try
        {
            var reader = DataReader.FromBuffer(buffer);
            var data = new byte[buffer.Length];
            reader.ReadBytes(data);
            return data;
        }
        catch
        {
            return null;
        }
    }

    private static async Task<bool> IsDfuPresentAsync()
    {
        // STM32 ROM DFU (commonly 0483:DF11).
        // If this fails due to capability/permission constraints in unpackaged mode,
        // the UI will simply show Update Mode as not detected.
        const ushort vid = 0x0483;
        const ushort pid = 0xDF11;

        var selector = UsbDevice.GetDeviceSelector(vid, pid);
        var devices = await DeviceInformation.FindAllAsync(selector);
        return devices.Count > 0;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
