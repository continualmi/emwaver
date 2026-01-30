using EMWaver.Models;
using Microsoft.UI.Dispatching;
using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Midi;
using Windows.Devices.Usb;
using Windows.Storage.Streams;

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
    private MidiOutPort? _outPort;

    private readonly object _rxLock = new();
    private TaskCompletionSource<byte[]?>? _responseTcs;
    private Func<byte[], bool>? _responsePredicate;

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
        _ = ui.TryEnqueue(action);
    }

    internal async Task RefreshPortsAsync()
    {
        try
        {
            LastErrorText = null;

            var inDevsTask = DeviceInformation.FindAllAsync(MidiInPort.GetDeviceSelector()).AsTask();
            var outDevsTask = DeviceInformation.FindAllAsync(MidiOutPort.GetDeviceSelector()).AsTask();
            var dfuTask = IsDfuPresentAsync();

            await Task.WhenAll(inDevsTask, outDevsTask, dfuTask);

            var inDevs = inDevsTask.Result;
            var outDevs = outDevsTask.Result;

            var pairs = inDevs
                .Select(i => new { In = i, Out = outDevs.FirstOrDefault(o => o.Name == i.Name) })
                .Where(p => p.Out != null)
                .Select(p => new DevicePort(
                    DisplayName: p.In.Name,
                    InDeviceId: p.In.Id,
                    OutDeviceId: p.Out!.Id
                ))
                .OrderBy(p => p.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToList();

            RunOnUi(() =>
            {
                AvailablePorts.Clear();
                foreach (var p in pairs) AvailablePorts.Add(p);
            });

            DfuConnected = dfuTask.Result;

            if (AutoConnectEnabled && !IsConnected)
            {
                var chosen = pairs.FirstOrDefault(p => p.DisplayName.Contains("emwaver", StringComparison.OrdinalIgnoreCase))
                    ?? pairs.FirstOrDefault(p => !p.DisplayName.Contains("network", StringComparison.OrdinalIgnoreCase))
                    ?? pairs.FirstOrDefault();
                if (chosen != null)
                {
                    await ConnectAsync(chosen);
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

            _inPort = await MidiInPort.FromIdAsync(port.InDeviceId);
            _outPort = await MidiOutPort.FromIdAsync(port.OutDeviceId);

            if (_inPort == null || _outPort == null)
            {
                Disconnect();
                LastErrorText = "Failed to open MIDI ports";
                return;
            }

            _inPort.MessageReceived += OnMidiMessage;
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
        }
        catch (Exception ex)
        {
            LastErrorText = ex.Message;
            Disconnect();
        }
    }

    internal void Disconnect()
    {
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

        lock (_rxLock)
        {
            _responseTcs?.TrySetResult(null);
            _responseTcs = null;
            _responsePredicate = null;
        }

        ConnectedPort = null;
        DeviceEmwaverVersion = null;
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

    private async Task<string?> QueryDeviceVersionAsync(int timeoutMs)
    {
        // Opcode 0x01 is "VERSION". Expected response lane: [0x80, major, minor, patch, 0...]
        var resp = await SendCommandAsync(
            commandLane: stackalloc byte[] { EmwOpcode.Version },
            timeoutMs: timeoutMs,
            responsePredicate: lane18 =>
            {
                if (lane18.Length < 4) return false;
                if (lane18[0] != 0x80) return false;
                for (int i = 4; i < lane18.Length; i++)
                {
                    if (lane18[i] != 0) return false;
                }
                return true;
            }
        );

        if (resp == null || resp.Length < 4 || resp[0] != 0x80)
        {
            return null;
        }

        return $"{resp[1]}.{resp[2]}.{resp[3]}";
    }

    private async Task<byte[]?> SendCommandAsync(ReadOnlySpan<byte> commandLane, int timeoutMs, Func<byte[], bool> responsePredicate)
    {
        if (_outPort == null || _inPort == null)
        {
            LastErrorText = "Cannot send command: Not connected";
            return null;
        }

        TaskCompletionSource<byte[]?> tcs;
        lock (_rxLock)
        {
            _responsePredicate = responsePredicate;
            _responseTcs = new TaskCompletionSource<byte[]?>(TaskCreationOptions.RunContinuationsAsynchronously);
            tcs = _responseTcs;
        }

        var pkt = MakeLanePacket(commandLane);
        var sf = MakeSuperframe(cmdLane: pkt, streamLane: null);
        SendSuperframe(sf);

        using var cts = new CancellationTokenSource(Math.Max(1, timeoutMs));
        using var reg = cts.Token.Register(() => tcs.TrySetResult(null));
        var result = await tcs.Task;

        lock (_rxLock)
        {
            _responseTcs = null;
            _responsePredicate = null;
        }

        return result;
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
                return;
            }

            var superframe = UsbMidiSysex.DecodeSysexToSuperframe(bytes);
            if (superframe == null || superframe.Length != SuperframeSizeBytes)
            {
                return;
            }

            var cmdLane = superframe.Take(LaneSizeBytes).ToArray();
            var streamLane = superframe.Skip(LaneSizeBytes).Take(LaneSizeBytes).ToArray();

            if (!IsAllZero(cmdLane)) HandleLane(cmdLane);
            if (!IsAllZero(streamLane)) HandleLane(streamLane);
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
    }

    private void HandleLane(byte[] lane18)
    {
        lock (_rxLock)
        {
            if (_responseTcs == null || _responsePredicate == null)
            {
                return;
            }
            if (!_responsePredicate(lane18))
            {
                return;
            }
            _responseTcs.TrySetResult(lane18);
        }
    }

    private void SendSuperframe(byte[] superframe36)
    {
        if (_outPort == null)
        {
            LastErrorText = "Cannot send: Not connected";
            return;
        }

        var sysex = UsbMidiSysex.EncodeSuperframe(superframe36);
        if (sysex == null)
        {
            LastErrorText = "SysEx encode failed";
            return;
        }

        var msg = new MidiSystemExclusiveMessage(BufferFromBytes(sysex));
        _outPort.SendMessage(msg);
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
            Buffer.BlockCopy(cmdLane, 0, sf, 0, Math.Min(cmdLane.Length, LaneSizeBytes));
        }
        if (streamLane != null)
        {
            Buffer.BlockCopy(streamLane, 0, sf, LaneSizeBytes, Math.Min(streamLane.Length, LaneSizeBytes));
        }
        return sf;
    }

    private static bool IsAllZero(byte[] bytes)
    {
        for (int i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] != 0) return false;
        }
        return true;
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
