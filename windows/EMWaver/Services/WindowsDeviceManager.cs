using EMWaver.Models;
using EMWaver.Interop;
using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Midi;
using Windows.Storage.Streams;
using System.Diagnostics;
using System.Linq;
using System.Text;

namespace EMWaver.Services;

public enum DeviceMode
{
    Disconnected = 0,
    RunMode = 1,
    UpdateMode = 2,
}

public sealed class WindowsDeviceManager : INotifyPropertyChanged
{
    private static readonly int LaneSizeBytes = 18;
    private static readonly int SuperframeSizeBytes = 36;
    private static class EmwOpcode
    {
        internal const byte Version = 0x01;
        internal const byte EnterDfu = 0x06;
        internal const byte Board = 0x09;
        internal const byte TransportSession = 0x0B;
    }

    private static class TransportSessionOpcode
    {
        internal const byte Status = 0x00;
        internal const byte Connect = 0x01;
        internal const byte Disconnect = 0x02;
        internal const byte Heartbeat = 0x03;
    }

    private static class TransportSource
    {
        internal const byte Usb = 0x01;
        internal const byte Ble = 0x02;
        internal const byte Wifi = 0x03;
    }

    public ObservableCollection<DevicePort> AvailablePorts { get; } = new();
    internal ObservableCollection<WindowsBleTransport.DiscoveredDevice> BleDiscoveredDevices { get; } = new();
    public ObservableCollection<WindowsWiFiTransport.DiscoveredDevice> WiFiDiscoveredDevices { get; } = new();
    private readonly WindowsWiFiDiscovery _wifiDiscovery = new();

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

    private readonly ObservableCollection<string> _activityLogLines = new();
    public string ActivityLogText => string.Join(Environment.NewLine, _activityLogLines);

    private string? _wifiProvisioningStatus;
    public string? WiFiProvisioningStatus
    {
        get => _wifiProvisioningStatus;
        private set
        {
            if (_wifiProvisioningStatus != value)
            {
                _wifiProvisioningStatus = value;
                OnPropertyChanged();
            }
        }
    }

    private bool _isWiFiProvisioningError;
    public bool IsWiFiProvisioningError
    {
        get => _isWiFiProvisioningError;
        private set
        {
            if (_isWiFiProvisioningError != value)
            {
                _isWiFiProvisioningError = value;
                OnPropertyChanged();
            }
        }
    }

    private bool _isWiFiProvisioning;
    public bool IsWiFiProvisioning
    {
        get => _isWiFiProvisioning;
        private set
        {
            if (_isWiFiProvisioning != value)
            {
                _isWiFiProvisioning = value;
                OnPropertyChanged();
            }
        }
    }

    private bool _isWiFiDiscovering;
    public bool IsWiFiDiscovering
    {
        get => _isWiFiDiscovering;
        private set
        {
            if (_isWiFiDiscovering != value)
            {
                _isWiFiDiscovering = value;
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

    private System.Windows.Threading.Dispatcher? _ui;

    private WindowsUsbMidiTransport.Connection? _usbMidiConnection;
    private WindowsBleTransport.ScanSession? _bleScanSession;
    private WindowsBleTransport.Connection? _bleConnection;
    private WindowsWiFiTransport.Connection? _wifiConnection;
    private readonly TransportDeviceConnectionState _activeConnectionState = new();
    private bool _bleConnecting;
    public bool IsBleConnecting
    {
        get => _bleConnecting;
        private set
        {
            if (_bleConnecting != value)
            {
                _bleConnecting = value;
                OnPropertyChanged();
            }
        }
    }
    private static readonly TimeSpan BleDiscoveryTtl = TimeSpan.FromSeconds(12);
    private bool _isBleScanning;
    public bool IsBleScanning
    {
        get => _isBleScanning;
        private set
        {
            if (_isBleScanning != value)
            {
                _isBleScanning = value;
                OnPropertyChanged();
            }
        }
    }
    private System.Threading.Timer? _transportHeartbeatTimer;
    private bool _transportSessionClaimed;
    private int _transportHeartbeatInFlight;
    private int _heartbeatMissedCount;
    private System.Threading.Timer? _connectionPollTimer;
    private readonly SemaphoreSlim _commandSemaphore = new(1, 1);
    private readonly TransportDeviceSessionRegistry _bufferSessions = new();

    private ITransportDeviceSession ActiveBufferSession => _bufferSessions.Active;

    internal byte[] GetActiveRxSnapshot() => ActiveBufferSession.GetRxSnapshot();
    internal void ClearActiveBuffer() => ActiveBufferSession.ClearAll();
    internal ulong GetActiveRxPacketCount() => ActiveBufferSession.GetRxPacketCount();
    internal ulong GetActiveTxPacketCount() => ActiveBufferSession.GetTxPacketCount();
    internal string ActiveBufferSessionId => _activeConnectionState.CurrentScriptDeviceId;

    internal byte[] GetRxSnapshot(string deviceId) => BufferSession(deviceId).GetRxSnapshot();
    internal void ClearBuffer(string deviceId) => BufferSession(deviceId).ClearAll();

    private ITransportDeviceSession BufferSession(string deviceId) => _bufferSessions.Session(deviceId);

    private ITransportDeviceSession SetActiveBufferSession(string deviceId, bool resetSession)
    {
        return _bufferSessions.Select(deviceId, resetSession);
    }

    private bool IsActiveDeviceSession(string deviceId)
    {
        return _activeConnectionState.MatchesDeviceId(deviceId);
    }

    private bool RequireActiveDeviceSession(string deviceId, string operation)
    {
        if (IsActiveDeviceSession(deviceId))
        {
            return true;
        }

        LastErrorText = $"{operation}: target device session is not active";
        AppendActivityLog($"Device {operation}: target session is not active: {deviceId}");
        return false;
    }

    private ITransportDeviceSession SetActiveDeviceTarget(string deviceId, DeviceTransport transport)
    {
        var target = _activeConnectionState.SetTarget(deviceId, transport);
        var session = SetActiveBufferSession(target.DeviceId, resetSession: true);
        ActiveTransport = target.Transport;
        _transportSessionClaimed = false;
        AppendActivityLog($"Active transport: {target.Transport} session={target.DeviceId}");
        return session;
    }

    private void AppendActivityLog(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        var line = $"{DateTime.Now:HH:mm:ss.fff} {text.Trim()}";
        Debug.WriteLine("[EMWaver][Transport] " + line);

        void Apply()
        {
            _activityLogLines.Add(line);
            while (_activityLogLines.Count > 300)
            {
                _activityLogLines.RemoveAt(0);
            }
            OnPropertyChanged(nameof(ActivityLogText));
        }

        var ui = _ui;
        if (ui == null || ui.CheckAccess()) Apply();
        else ui.BeginInvoke((Action)Apply);
    }

    internal void ClearActivityLog()
    {
        void Apply()
        {
            _activityLogLines.Clear();
            OnPropertyChanged(nameof(ActivityLogText));
        }

        var ui = _ui;
        if (ui == null || ui.CheckAccess()) Apply();
        else ui.BeginInvoke((Action)Apply);
    }

    private static string Hex(byte[] bytes, int max = 18)
    {
        if (bytes == null || bytes.Length == 0) return "<empty>";
        var take = Math.Min(bytes.Length, max);
        var text = string.Join(" ", bytes.Take(take).Select(b => b.ToString("X2")));
        return bytes.Length > take ? text + $" … (+{bytes.Length - take})" : text;
    }

    private void AppendIncomingSysexLog(byte[] bytes, string transportLabel)
    {
        var superframe = UsbMidiSysex.DecodeSysexToSuperframe(bytes);
        if (superframe == null || superframe.Length < SuperframeSizeBytes)
        {
            // Non-EMWaver SYSEX (e.g. heartbeats, BLE housekeeping) — silent.
            return;
        }

        var cmdLane = new byte[LaneSizeBytes];
        var streamLane = new byte[LaneSizeBytes];
        Array.Copy(superframe, 0, cmdLane, 0, LaneSizeBytes);
        Array.Copy(superframe, LaneSizeBytes, streamLane, 0, LaneSizeBytes);
        if (cmdLane.Any(b => b != 0)) AppendActivityLog($"RX {transportLabel} cmd={Hex(cmdLane)}");
        if (streamLane.Any(b => b != 0)) AppendActivityLog($"RX {transportLabel} stream={Hex(streamLane)}");
    }

    private void ClearActiveDeviceTarget()
    {
        _activeConnectionState.Clear();
        _transportSessionClaimed = false;
        ActiveTransport = DeviceTransport.None;
    }

    private string? ActiveDeviceSessionId(DeviceTransport transport)
    {
        return _activeConnectionState.MatchesTransport(transport) ? _activeConnectionState.CurrentScriptDeviceId : null;
    }

    internal void AttachUiDispatcher(System.Windows.Threading.Dispatcher dispatcher)
    {
        _ui = dispatcher;
    }

    private void RunOnUi(Action action)
    {
        var ui = _ui;
        if (ui == null)
        {
            action();
            return;
        }
        ui.Invoke(action);
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
            PruneBleDiscoveredDevices();

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
            else
            {
                StartBleScan();
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
            var session = SetActiveDeviceTarget(WindowsUsbMidiTransport.SessionId(port), DeviceTransport.UsbMidi);
            var connection = await WindowsUsbMidiTransport.OpenConnectionAsync(port, OnMidiMessage, session);
            _usbMidiConnection = connection;
            _activeConnectionState.SetConnection(connection);

            if (!connection.IsOpen)
            {
                Disconnect();
                LastErrorText = "Failed to open MIDI ports";
                return;
            }

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
            ApplyTransportDebugPreference();

            _ = Task.Run(async () =>
            {
                try
                {
                    var reportedBoardType = await QueryBoardTypeAsync(timeoutMs: 1500);
                    var boardType = reportedBoardType ?? connection.InferBoardType();
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
                        ConnectedBoardType = connection.InferBoardType();
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
            usbMidiConnection.Dispose();
            _usbMidiConnection = null;
        }

        CloseBleDevice();
        IsBleConnecting = false;
        CloseWiFiDevice();
        StopTransportSessionHeartbeat();

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

    private async Task<string?> QueryDeviceVersionAsync(int timeoutMs)
    {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        var resp = await SendCommandAsync(
            commandLane: new byte[] { EmwOpcode.Version },
            timeoutMs: timeoutMs,
            responsePredicate: lane18 =>
            {
                if (lane18.Length < 3) return false;
                if (lane18[0] != 0x80) return false;
                for (int i = 4; i < lane18.Length; i++)
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

        var patch = resp.Length >= 4 ? resp[3] : (byte)0;
        return $"{resp[1]}.{resp[2]}.{patch}";
    }

    private async Task<string?> QueryBoardTypeAsync(int timeoutMs)
    {
        var resp = await SendCommandAsync(
            commandLane: new byte[] { EmwOpcode.Board },
            timeoutMs: timeoutMs,
            responsePredicate: lane18 => lane18.Length > 0 && (lane18[0] == 0x80 || lane18[0] == 0x81)
        );

        if (resp == null || resp.Length < 2 || resp[0] != 0x80)
        {
            return null;
        }

        var end = 1;
        while (end < resp.Length && resp[end] != 0) end++;
        if (end <= 1) return null;

        var board = Encoding.UTF8.GetString(resp, 1, end - 1).Trim().ToLowerInvariant();
        return NormalizeBoardType(board);
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
        else if (ActiveTransport == DeviceTransport.Wifi)
        {
            if (_wifiConnection?.IsOpen != true)
            {
                LastErrorText = "Cannot send command: Wi-Fi not connected";
                return null;
            }
        }
        else if (_usbMidiConnection?.IsOpen != true)
        {
            LastErrorText = "Cannot send command: Not connected";
            return null;
        }

        var opcode = commandLane.Length > 0 ? commandLane[0] : (byte)0;
        await _commandSemaphore.WaitAsync();
        try
        {
            var tcs = session.BeginResponseWait(responsePredicate);

            using var cts = new CancellationTokenSource(Math.Max(1, timeoutMs));
            using var reg = cts.Token.Register(() => tcs.TrySetResult(null));
            try
            {
                var pkt = MakeLanePacket(commandLane);
                var sf = MakeSuperframe(cmdLane: pkt, streamLane: null);
                AppendActivityLog($"TX {ActiveTransport} opcode=0x{opcode:X2} timeout={timeoutMs}ms bytes={Hex(commandLane)}");
                SendSuperframe(sf, session);
                var response = await tcs.Task;
                if (response == null)
                {
                    AppendActivityLog($"TIMEOUT {ActiveTransport} opcode=0x{opcode:X2} after {timeoutMs}ms");
                }
                else
                {
                    AppendActivityLog($"RX {ActiveTransport} opcode=0x{opcode:X2} bytes={Hex(response)}");
                }
                return response;
            }
            finally
            {
                session.ClearResponseWait(tcs);
            }
        }
        finally
        {
            _commandSemaphore.Release();
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

            var session = _usbMidiConnection?.InPort == sender
                ? _usbMidiConnection.Session
                : null;
            ProcessIncomingSysex(bytes, "MIDI", session, ActiveDeviceSessionId(DeviceTransport.UsbMidi));
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
    }

    private void ProcessIncomingSysex(byte[] bytes, string transportLabel, string? deviceId = null)
    {
        Debug.WriteLine($"[EMWaver][{transportLabel}][RX] sysex={bytes.Length}");
        AppendIncomingSysexLog(bytes, transportLabel);
        var session = string.IsNullOrWhiteSpace(deviceId)
            ? ActiveBufferSession
            : BufferSession(deviceId);
        session.FeedSysexBytes(bytes, NowMs());
    }

    private void ProcessIncomingSysex(
        byte[] bytes,
        string transportLabel,
        ITransportDeviceSession? transportSession,
        string? fallbackDeviceId = null)
    {
        Debug.WriteLine($"[EMWaver][{transportLabel}][RX] sysex={bytes.Length}");
        AppendIncomingSysexLog(bytes, transportLabel);
        var session = transportSession
            ?? (string.IsNullOrWhiteSpace(fallbackDeviceId) ? ActiveBufferSession : BufferSession(fallbackDeviceId));
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
        if (!await EnsureTransportSessionClaimedAsync())
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
        if (ActiveTransport == DeviceTransport.Wifi)
        {
            SendWiFiSuperframe(superframe36, session);
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

    internal void StartBleDiscovery()
    {
        StartBleScan();
    }

    private void StartBleScan()
    {
        if (_bleScanSession != null || IsBleConnecting)
        {
            return;
        }

        try
        {
            var scanSession = WindowsBleTransport.OpenScanSession(OnBleAdvertisementReceived);
            _bleScanSession = scanSession;
            scanSession.Start();
            IsBleScanning = true;
            Debug.WriteLine("[EMWaver][BLE] scan started");
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    private void StopBleScan()
    {
        WindowsBleTransport.CloseHandles(_bleScanSession);
        _bleScanSession = null;
        IsBleScanning = false;
    }

    internal void PruneBleDiscoveredDevices()
    {
        RunOnUi(PruneBleDiscoveredDevicesOnUi);
    }

    private void PruneBleDiscoveredDevicesOnUi()
    {
        var cutoff = DateTime.Now - BleDiscoveryTtl;
        for (var i = BleDiscoveredDevices.Count - 1; i >= 0; i--)
        {
            if (BleDiscoveredDevices[i].LastSeen < cutoff)
            {
                BleDiscoveredDevices.RemoveAt(i);
            }
        }
    }

    private void OnBleAdvertisementReceived(BluetoothLEAdvertisementWatcher sender, BluetoothLEAdvertisementReceivedEventArgs args)
    {
        var name = args.Advertisement.LocalName ?? string.Empty;
        if (!WindowsBleTransport.MatchesAdvertisementName(name))
        {
            return;
        }

        var discovered = new WindowsBleTransport.DiscoveredDevice(
            WindowsBleTransport.SessionId(args.BluetoothAddress),
            args.BluetoothAddress,
            args.BluetoothAddressType,
            WindowsBleTransport.DisplayName(args),
            WindowsBleTransport.BoardType(WindowsBleTransport.DisplayName(args)),
            DateTime.Now);

        RunOnUi(() =>
        {
            PruneBleDiscoveredDevicesOnUi();
            var existing = BleDiscoveredDevices.FirstOrDefault(d => d.BluetoothAddress == discovered.BluetoothAddress);
            if (existing != null) BleDiscoveredDevices.Remove(existing);
            BleDiscoveredDevices.Add(discovered);
        });

        if (IsBleConnecting || IsConnected || !AutoConnectEnabled)
        {
            return;
        }

        IsBleConnecting = true;
        StopBleScan();
        _ = ConnectBleAsync(args.BluetoothAddress, args.BluetoothAddressType, discovered.DisplayName);
    }

    internal Task ConnectBleAsync(WindowsBleTransport.DiscoveredDevice device)
    {
        return ConnectBleAsync(device.BluetoothAddress, device.AddressType, device.DisplayName);
    }

    private async Task ConnectBleAsync(ulong bluetoothAddress, BluetoothAddressType addressType, string displayName)
    {
        try
        {
            IsBleConnecting = true;
            LastErrorText = null;
            DeviceEmwaverVersion = null;
            ConnectedBoardType = null;

            CloseBleDevice();
            var session = SetActiveDeviceTarget(WindowsBleTransport.SessionId(bluetoothAddress), DeviceTransport.Ble);

            AppendActivityLog($"BLE open {displayName} address=0x{bluetoothAddress:X} type={addressType}");
            var opened = await WindowsBleTransport.OpenConnectionAsync(bluetoothAddress, addressType, displayName, OnBleValueChanged, session);
            if (opened.Connection == null)
            {
                LastErrorText = opened.Error;
                AppendActivityLog($"BLE open failed: {opened.Error ?? "unknown error"}");
                ClearActiveDeviceTarget();
                return;
            }

            _bleConnection = opened.Connection;
            _activeConnectionState.SetConnection(_bleConnection);

            var version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            if (version == null)
            {
                await Task.Delay(250);
                version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            }

            if (version == null)
            {
                LastErrorText = "BLE device did not respond like an EMWaver device";
                Disconnect();
                return;
            }

            ConnectedPort = new DevicePort(_bleConnection.DisplayName, string.Empty, string.Empty);
            DeviceEmwaverVersion = version;
            var reportedBoardType = await QueryBoardTypeAsync(timeoutMs: 2000);
            ConnectedBoardType = reportedBoardType ?? WindowsBleTransport.BoardType(displayName);
            LastDetectedBoardType = ConnectedBoardType;
            ApplyTransportDebugPreference();
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            Disconnect();
        }
        finally
        {
            IsBleConnecting = false;
        }
    }

    private async void OnBleValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        try
        {
            var bytes = BufferFromIbuffer(args.CharacteristicValue);
            if (bytes != null)
            {
                var session = _bleConnection?.NotifyCharacteristic == sender
                    ? _bleConnection.Session
                    : null;
                ProcessIncomingSysex(bytes, "BLE", session, ActiveDeviceSessionId(DeviceTransport.Ble));
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
        WindowsBleTransport.CloseHandles(_bleConnection);
        _bleConnection = null;
    }

    private static byte TransportSourceFor(DeviceTransport transport)
    {
        return transport switch
        {
            DeviceTransport.UsbMidi => TransportSource.Usb,
            DeviceTransport.Ble => TransportSource.Ble,
            DeviceTransport.Wifi => TransportSource.Wifi,
            _ => 0,
        };
    }

    private bool RequiresTransportSession()
    {
        if (ActiveTransport == DeviceTransport.Ble || ActiveTransport == DeviceTransport.Wifi)
        {
            return true;
        }
        if (ActiveTransport == DeviceTransport.UsbMidi)
        {
            var board = ConnectedBoardType ?? LastDetectedBoardType ?? string.Empty;
            return board.StartsWith("esp", StringComparison.OrdinalIgnoreCase);
        }
        return false;
    }

    private async Task<bool> EnsureTransportSessionClaimedAsync()
    {
        if (!RequiresTransportSession())
        {
            return true;
        }
        if (_transportSessionClaimed)
        {
            return true;
        }

        return await ClaimTransportSessionAsync(ActiveTransport);
    }

    private async Task<bool> ClaimTransportSessionAsync(DeviceTransport transport)
    {
        var source = TransportSourceFor(transport);
        if (source == 0) return false;

        var response = await SendCommandAsync(
            new byte[] { EmwOpcode.TransportSession, TransportSessionOpcode.Connect, source },
            timeoutMs: 1500,
            ActiveBufferSession,
            lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81 || lane[0] == 0x82));

        var ok = response != null && response.Length > 0 && response[0] == 0x80;
        AppendActivityLog(ok
            ? $"Transport session claimed for {transport}"
            : $"Transport session claim failed for {transport} response={(response == null ? "<timeout>" : Hex(response))}");

        if (ok)
        {
            _transportSessionClaimed = true;
            StartTransportSessionHeartbeat(transport);
        }
        return ok;
    }

    private void StartTransportSessionHeartbeat(DeviceTransport transport)
    {
        StopTransportSessionHeartbeat();
        var source = TransportSourceFor(transport);
        if (source == 0) return;

        _heartbeatMissedCount = 0;
        var heartbeatIntervalMs = 2000;

        _transportHeartbeatTimer = new System.Threading.Timer(async _ =>
        {
            if (Interlocked.Exchange(ref _transportHeartbeatInFlight, 1) == 1)
            {
                Interlocked.Increment(ref _heartbeatMissedCount);
                return;
            }
            try
            {
                if (!IsConnected)
                {
                    _heartbeatMissedCount = 0;
                    return;
                }

                var response = await SendCommandAsync(
                    new byte[] { EmwOpcode.TransportSession, TransportSessionOpcode.Heartbeat, source },
                    timeoutMs: 1000,
                    ActiveBufferSession,
                    lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81 || lane[0] == 0x82));

                if (response != null && response.Length > 0 && response[0] == 0x80)
                {
                    _heartbeatMissedCount = 0;
                }
                else
                {
                    var missed = Interlocked.Increment(ref _heartbeatMissedCount);
                    AppendActivityLog($"Transport session heartbeat missed ({missed}) — {ActiveTransport}");
                    if (missed >= 2)
                    {
                        AppendActivityLog($"Transport session lost after {missed} missed heartbeats — disconnecting");
                        RunOnUi(() =>
                        {
                            LastErrorText = "Device connection lost (heartbeat timeout)";
                            Disconnect();
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                var missed = Interlocked.Increment(ref _heartbeatMissedCount);
                AppendActivityLog($"Transport session heartbeat error ({missed}): {ex.Message}");
                if (missed >= 2)
                {
                    AppendActivityLog($"Transport session lost after heartbeat errors — disconnecting");
                    RunOnUi(() =>
                    {
                        LastErrorText = "Device connection lost (heartbeat error)";
                        Disconnect();
                    });
                }
            }
            finally
            {
                Interlocked.Exchange(ref _transportHeartbeatInFlight, 0);
            }
        }, null, dueTime: heartbeatIntervalMs, period: heartbeatIntervalMs);
    }

    private void StopTransportSessionHeartbeat()
    {
        var timer = _transportHeartbeatTimer;
        _transportHeartbeatTimer = null;
        _heartbeatMissedCount = 0;
        timer?.Dispose();
    }

    private void StartConnectionPolling()
    {
        if (_connectionPollTimer != null) return;
        _connectionPollTimer = new System.Threading.Timer(async _ =>
        {
            try
            {
                await PollConnectionsAsync();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[EMWaver] Connection poll error: {ex.Message}");
            }
        }, null, dueTime: 5000, period: 5000);
    }

    private async Task PollConnectionsAsync()
    {
        // Reconcile USB MIDI: if a physical MIDI port we were connected to is gone, disconnect.
        if (_activeTransport == DeviceTransport.UsbMidi && _usbMidiConnection != null)
        {
            var currentPorts = await WindowsUsbMidiTransport.ListPortsAsync();
            var stillPresent = currentPorts.Any(p =>
                p.InDeviceId == _usbMidiConnection.Port.InDeviceId &&
                p.OutDeviceId == _usbMidiConnection.Port.OutDeviceId);
            if (!stillPresent)
            {
                AppendActivityLog("USB MIDI port removed — disconnecting");
                RunOnUi(() =>
                {
                    LastErrorText = "USB MIDI device disconnected";
                    Disconnect();
                });
            }
        }

        // Reconcile BLE: check if the connected peripheral is still reachable.
        if (_activeTransport == DeviceTransport.Ble && _bleConnection != null)
        {
            try
            {
                var device = await BluetoothLEDevice.FromBluetoothAddressAsync(_bleConnection.BluetoothAddress);
                if (device == null || device.ConnectionStatus != BluetoothConnectionStatus.Connected)
                {
                    AppendActivityLog("BLE device no longer connected — disconnecting");
                    device?.Dispose();
                    RunOnUi(() =>
                    {
                        LastErrorText = "BLE device disconnected";
                        Disconnect();
                    });
                }
                else
                {
                    device.Dispose();
                }
            }
            catch
            {
                // If we can't even query the device, assume it's gone.
                AppendActivityLog("BLE device unreachable — disconnecting");
                RunOnUi(() =>
                {
                    LastErrorText = "BLE device disconnected";
                    Disconnect();
                });
            }
        }
    }

    internal void BeginConnectionMonitoring()
    {
        StartConnectionPolling();
    }

    internal void ApplyTransportDebugPreference()
    {
        // Parity with macOS: ask firmware to emit/stop transport diagnostics when supported.
        // Older firmware may ignore this; command logging above still records TX/RX/timeout locally.
        var enabled = AppServices.Settings.TransportDebugLoggingEnabled;
        _ = Task.Run(async () =>
        {
            try
            {
                var command = Encoding.UTF8.GetBytes(enabled ? "debug transport 1" : "debug transport 0");
                _ = await SendCommandAsync(
                    command,
                    timeoutMs: 1000,
                    ActiveBufferSession,
                    lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81 || lane[0] == 0x82));
            }
            catch (Exception ex)
            {
                AppendActivityLog("Transport debug enable failed: " + ex.Message);
            }
        });
    }

    internal async Task ConnectWiFiAsync(string host, int port)
    {
        var trimmedHost = host?.Trim() ?? string.Empty;
        var safePort = WindowsWiFiTransport.IsValidPort(port) ? port : WindowsWiFiTransport.DefaultPort;
        if (!WindowsWiFiTransport.IsValidManualHost(trimmedHost))
        {
            LastErrorText = "Wi-Fi host must be a hostname or IP address";
            return;
        }

        Disconnect();

        try
        {
            LastErrorText = null;
            DeviceEmwaverVersion = null;
            ConnectedBoardType = null;

            var key = $"{trimmedHost}:{safePort}";
            var session = SetActiveDeviceTarget(WindowsWiFiTransport.SessionId(key), DeviceTransport.Wifi);
            var connection = await WindowsWiFiTransport.OpenConnectionAsync(
                trimmedHost,
                safePort,
                bytes => ProcessIncomingSysex(bytes, "Wi-Fi", _wifiConnection?.Session, ActiveDeviceSessionId(DeviceTransport.Wifi)),
                session);

            _wifiConnection = connection;
            _activeConnectionState.SetConnection(connection);
            ConnectedPort = new DevicePort(connection.DisplayName, string.Empty, string.Empty);

            var version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            if (version == null)
            {
                await Task.Delay(250);
                version = await QueryDeviceVersionAsync(timeoutMs: 1500);
            }

            if (version == null)
            {
                LastErrorText = "Wi-Fi endpoint did not respond like an EMWaver device";
                Disconnect();
                return;
            }

            var reportedBoardType = await QueryBoardTypeAsync(timeoutMs: 1500);
            DeviceEmwaverVersion = version;
            ConnectedBoardType = reportedBoardType ?? "esp32";
            LastDetectedBoardType = ConnectedBoardType;
            ApplyTransportDebugPreference();
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            Disconnect();
        }
    }

    internal void StartWiFiDiscovery()
    {
        IsWiFiDiscovering = true;
        _wifiDiscovery.Start(
            devices => RunOnUi(() =>
            {
                WiFiDiscoveredDevices.Clear();
                foreach (var device in devices)
                {
                    WiFiDiscoveredDevices.Add(device);
                }
            }),
            message => RunOnUi(() => LastErrorText = message));
    }

    internal void StopWiFiDiscovery()
    {
        IsWiFiDiscovering = false;
        _wifiDiscovery.Stop(clearDevices: false);
    }

    internal async Task ProvisionWiFiAsync(string ssid, string password)
    {
        var commands = WindowsWiFiTransport.ProvisioningCommands(ssid, password);
        if (commands == null)
        {
            FinishWiFiProvisioning("Wi-Fi SSID is required and setup values must fit the ESP32 limits.", isError: true);
            return;
        }

        SetWiFiProvisioningBusy("Sending Wi-Fi setup");
        if (!IsConnected)
        {
            FinishWiFiProvisioning("Connect a Wi-Fi-capable ESP32 board before provisioning Wi-Fi.", isError: true);
            return;
        }
        if (!await EnsureTransportSessionClaimedAsync())
        {
            FinishWiFiProvisioning("The ESP32 board did not accept the local transport session.", isError: true);
            return;
        }

        foreach (var command in commands)
        {
            if (!WindowsWiFiTransport.IsOkResponse(await SendCommandAsync(command, timeoutMs: 2000, lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81))))
            {
                FinishWiFiProvisioning("Wi-Fi setup was rejected by the device.", isError: true);
                return;
            }
        }

        FinishWiFiProvisioning("Wi-Fi setup sent. The ESP32 board will join the network and advertise itself with mDNS.", isError: false);
    }

    internal async Task ClearWiFiProvisioningAsync()
    {
        SetWiFiProvisioningBusy("Clearing Wi-Fi setup");
        if (!IsConnected)
        {
            FinishWiFiProvisioning("Connect a Wi-Fi-capable ESP32 board before clearing Wi-Fi setup.", isError: true);
            return;
        }
        if (!await EnsureTransportSessionClaimedAsync())
        {
            FinishWiFiProvisioning("The ESP32 board did not accept the local transport session.", isError: true);
            return;
        }

        var response = await SendCommandAsync(
            WindowsWiFiTransport.ClearProvisioningCommand(),
            timeoutMs: 2000,
            lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81));
        if (!WindowsWiFiTransport.IsOkResponse(response))
        {
            FinishWiFiProvisioning("Wi-Fi setup clear was rejected by the device.", isError: true);
            return;
        }

        FinishWiFiProvisioning("Wi-Fi setup cleared. Provision the ESP32 board again before using Wi-Fi control.", isError: false);
    }

    internal async Task RefreshWiFiProvisioningStatusAsync()
    {
        SetWiFiProvisioningBusy("Checking Wi-Fi status");
        if (!IsConnected)
        {
            FinishWiFiProvisioning("Connect a Wi-Fi-capable ESP32 board before checking Wi-Fi status.", isError: true);
            return;
        }
        if (!await EnsureTransportSessionClaimedAsync())
        {
            FinishWiFiProvisioning("The ESP32 board did not accept the local transport session.", isError: true);
            return;
        }

        var response = await SendCommandAsync(
            WindowsWiFiTransport.StatusCommand(),
            timeoutMs: 2000,
            lane => lane.Length > 0 && (lane[0] == 0x80 || lane[0] == 0x81));
        var message = WindowsWiFiTransport.StatusMessage(response);
        if (message == null)
        {
            FinishWiFiProvisioning("Wi-Fi status request was rejected by the device.", isError: true);
            return;
        }

        FinishWiFiProvisioning(message, isError: false);
    }

    private void SetWiFiProvisioningBusy(string message)
    {
        RunOnUi(() =>
        {
            IsWiFiProvisioning = true;
            IsWiFiProvisioningError = false;
            WiFiProvisioningStatus = message;
        });
    }

    private void FinishWiFiProvisioning(string message, bool isError)
    {
        if (isError)
        {
            LastErrorText = message;
        }
        RunOnUi(() =>
        {
            IsWiFiProvisioning = false;
            IsWiFiProvisioningError = isError;
            WiFiProvisioningStatus = message;
        });
    }

    private void SendWiFiSuperframe(byte[] superframe36, ITransportDeviceSession session)
    {
        var connection = _wifiConnection;
        if (connection == null || !connection.IsOpen)
        {
            LastErrorText = "Cannot send: Wi-Fi not connected";
            return;
        }

        session.AppendTxBytes(superframe36, NowMs());
        try
        {
            LastErrorText = connection.SendSysexAsync(superframe36).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
        }
    }

    private void CloseWiFiDevice()
    {
        _wifiConnection?.Dispose();
        _wifiConnection = null;
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

    private static Task<bool> IsDfuPresentAsync() => Dfu.IsPresentAsync();

    private static string? NormalizeBoardType(string? boardType)
    {
        return (boardType ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "esp32" => "esp32",
            "esp32-s2" or "esp32s2" => "esp32s2",
            "esp32-s3" or "esp32s3" => "esp32s3",
            "stm32f042" or "stm32" => "stm32f042",
            "" => null,
            var other => other,
        };
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
