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

    private WindowsUsbMidiTransport.Connection? _usbMidiConnection;
    private WindowsBleTransport.ScanSession? _bleScanSession;
    private WindowsBleTransport.Connection? _bleConnection;
    private bool _bleConnecting;
    private ActiveDeviceTarget _activeDeviceTarget = ActiveDeviceTarget.None;
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

    private void SetActiveBufferSession(string deviceId, bool resetSession)
    {
        lock (_bufferSessionLock)
        {
            var session = BufferSession(deviceId);
            _activeBufferSession = session;
            if (resetSession)
            {
                _activeBufferSession.ClearAll();
            }
        }
    }

    private bool IsActiveDeviceSession(string deviceId)
    {
        return _activeDeviceTarget.MatchesDeviceId(deviceId);
    }

    private bool RequireActiveDeviceSession(string deviceId, string operation)
    {
        if (IsActiveDeviceSession(deviceId))
        {
            return true;
        }

        LastErrorText = $"{operation}: target device session is not active";
        Debug.WriteLine($"[EMWaver][Windows][Device] {operation}: target session is not active: {deviceId}");
        return false;
    }

    private void SetActiveDeviceTarget(string deviceId, DeviceTransport transport)
    {
        var target = new ActiveDeviceTarget(deviceId, transport);
        SetActiveBufferSession(target.DeviceId, resetSession: true);
        _activeDeviceTarget = target;
        ActiveTransport = target.Transport;
    }

    private void ClearActiveDeviceTarget()
    {
        _activeDeviceTarget = ActiveDeviceTarget.None;
        ActiveTransport = DeviceTransport.None;
    }

    private string? ActiveDeviceSessionId(DeviceTransport transport)
    {
        return _activeDeviceTarget.MatchesTransport(transport) ? _activeDeviceTarget.DeviceId : null;
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

            var portsTask = WindowsUsbMidiTransport.ListPortsAsync();
            var dfuTask = IsDfuPresentAsync();

            await Task.WhenAll(portsTask, dfuTask);
            var pairs = portsTask.Result;

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
            var connection = await WindowsUsbMidiTransport.OpenConnectionAsync(port);
            _usbMidiConnection = connection;
            SetActiveDeviceTarget(connection.SessionId, DeviceTransport.UsbMidi);

            if (!connection.IsOpen)
            {
                Disconnect();
                LastErrorText = "Failed to open MIDI ports";
                return;
            }

            connection.InPort!.MessageReceived += OnMidiMessage;
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

        var usbMidiConnection = _usbMidiConnection;
        if (usbMidiConnection != null)
        {
            try
            {
                if (usbMidiConnection.InPort != null)
                {
                    usbMidiConnection.InPort.MessageReceived -= OnMidiMessage;
                }
            }
            catch
            {
                // Ignore detach errors.
            }

            usbMidiConnection.Dispose();
            _usbMidiConnection = null;
        }

        CloseBleDevice();

        ActiveBufferSession.CancelResponseWait();
        ClearActiveDeviceTarget();

        ConnectedPort = null;
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
            if (_usbMidiConnection?.OutPort == null)
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
            if (_bleConnection?.IsOpen != true)
            {
                LastErrorText = "Cannot send command: BLE not connected";
                return null;
            }
        }
        else if (_usbMidiConnection?.IsOpen != true)
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
            SendSuperframe(sf, session);
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

            ProcessIncomingSysex(bytes, "MIDI", ActiveDeviceSessionId(DeviceTransport.UsbMidi));
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
        if (!RequireActiveDeviceSession(deviceId, "SendPacket"))
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
        SendSuperframe(superframe36, ActiveBufferSession);
    }

    private void SendSuperframe(byte[] superframe36, ITransportDeviceSession session)
    {
        if (ActiveTransport == DeviceTransport.Ble)
        {
            SendBleSuperframe(superframe36, session);
            return;
        }

        var connection = _usbMidiConnection;
        if (connection == null || !connection.IsOpen)
        {
            LastErrorText = "Cannot send: Not connected";
            return;
        }

        // Log TX for buffer parity/debugging (Rust buffer core chunks to 18B packets).
        session.AppendTxBytes(superframe36, NowMs());

        LastErrorText = connection.SendSuperframe(superframe36, BufferFromBytes);
    }

    private void StartBleScan()
    {
        if (_bleScanSession != null || _bleConnecting || IsConnected)
        {
            return;
        }

        try
        {
            var scanSession = WindowsBleTransport.OpenScanSession(OnBleAdvertisementReceived);
            _bleScanSession = scanSession;
            scanSession.Start();
            Debug.WriteLine("[EMWaver][BLE] scan started");
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    private void StopBleScan()
    {
        var scanSession = _bleScanSession;
        if (scanSession == null)
        {
            return;
        }

        try
        {
            scanSession.Dispose();
        }
        catch
        {
            // Ignore watcher shutdown errors.
        }
        finally
        {
            _bleScanSession = null;
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
            SetActiveDeviceTarget(WindowsBleTransport.SessionId(bluetoothAddress), DeviceTransport.Ble);

            CloseBleDevice();

            var opened = await WindowsBleTransport.OpenConnectionAsync(bluetoothAddress, displayName, OnBleValueChanged);
            if (opened.Connection == null)
            {
                LastErrorText = opened.Error;
                return;
            }

            _bleConnection = opened.Connection;
            ConnectedPort = new DevicePort(_bleConnection.DisplayName, string.Empty, string.Empty);

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
                ProcessIncomingSysex(bytes, "BLE", ActiveDeviceSessionId(DeviceTransport.Ble));
            }
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
    }

    private void SendBleSuperframe(byte[] superframe36)
    {
        SendBleSuperframe(superframe36, ActiveBufferSession);
    }

    private void SendBleSuperframe(byte[] superframe36, ITransportDeviceSession session)
    {
        var connection = _bleConnection;
        if (connection == null || !connection.IsOpen)
        {
            LastErrorText = "Cannot send: BLE not connected";
            return;
        }

        session.AppendTxBytes(superframe36, NowMs());
        LastErrorText = connection.SendSuperframe(superframe36, BufferFromBytes);
    }

    private void CloseBleDevice()
    {
        if (_bleConnection != null)
        {
            _bleConnection.Dispose();
            _bleConnection = null;
        }
        _bleConnecting = false;
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
