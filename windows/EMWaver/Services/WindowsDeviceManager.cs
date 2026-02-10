using EMWaver.Models;
using EMWaver.Interop;
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
        internal const byte IdentityGet = 0x07;
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

    private bool _isSecureConnected;
    public bool IsSecureConnected
    {
        get => _isSecureConnected;
        private set
        {
            if (_isSecureConnected != value)
            {
                _isSecureConnected = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _secureDeviceIdHex;
    public string? SecureDeviceIdHex
    {
        get => _secureDeviceIdHex;
        private set
        {
            if (_secureDeviceIdHex != value)
            {
                _secureDeviceIdHex = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _secureDeviceIdB64;
    public string? SecureDeviceIdB64
    {
        get => _secureDeviceIdB64;
        private set
        {
            if (_secureDeviceIdB64 != value)
            {
                _secureDeviceIdB64 = value;
                OnPropertyChanged();
            }
        }
    }

    private string? _secureDeviceProofB64;
    public string? SecureDeviceProofB64
    {
        get => _secureDeviceProofB64;
        private set
        {
            if (_secureDeviceProofB64 != value)
            {
                _secureDeviceProofB64 = value;
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
        _ = ui.TryEnqueue(() => action());
    }

    internal async Task RefreshPortsAsync()
    {
        try
        {
            LastErrorText = null;

            // Pair MIDI IN/OUT by container id (same physical USB device) rather than
            // relying on exact Name matches, which are not stable across drivers.
            var props = new[] { "System.Devices.ContainerId" };

            var inDevsTask = DeviceInformation.FindAllAsync(MidiInPort.GetDeviceSelector(), props).AsTask();
            var outDevsTask = DeviceInformation.FindAllAsync(MidiOutPort.GetDeviceSelector(), props).AsTask();
            var dfuTask = IsDfuPresentAsync();

            await Task.WhenAll(inDevsTask, outDevsTask, dfuTask);

            var inDevs = inDevsTask.Result;
            var outDevs = outDevsTask.Result;

            static string? ContainerIdOf(DeviceInformation d)
            {
                if (d.Properties == null) return null;
                if (!d.Properties.TryGetValue("System.Devices.ContainerId", out var v)) return null;
                return v?.ToString();
            }

            var outByContainerId = outDevs
                .Select(d => new { Dev = d, Cid = ContainerIdOf(d) })
                .Where(x => !string.IsNullOrWhiteSpace(x.Cid))
                .GroupBy(x => x.Cid!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Dev, StringComparer.OrdinalIgnoreCase);

            var pairs = inDevs
                .Select(i =>
                {
                    var cid = ContainerIdOf(i);
                    if (!string.IsNullOrWhiteSpace(cid) && outByContainerId.TryGetValue(cid!, out var o))
                    {
                        return new { In = i, Out = o };
                    }

                    // Fallback: best-effort match by name.
                    var byName = outDevs.FirstOrDefault(o => o.Name == i.Name);
                    if (byName != null)
                    {
                        return new { In = i, Out = byName };
                    }

                    // Last fallback: case-insensitive contains match (helps when IN/OUT
                    // ports include suffixes like "(MIDI In)" / "(MIDI Out)").
                    var byContains = outDevs.FirstOrDefault(o =>
                        o.Name.Contains(i.Name, StringComparison.OrdinalIgnoreCase)
                        || i.Name.Contains(o.Name, StringComparison.OrdinalIgnoreCase));

                    return byContains == null ? null : new { In = i, Out = byContains };
                })
                .Where(p => p != null)
                .Select(p => new DevicePort(
                    DisplayName: p!.In.Name,
                    InDeviceId: p.In.Id,
                    OutDeviceId: p.Out.Id
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
            IsSecureConnected = false;
            SecureDeviceIdHex = null;
            SecureDeviceIdB64 = null;
            SecureDeviceProofB64 = null;

            // Keep parity with iOS/macOS: clear shared buffer state on connect.
            NativeBufferRust.ClearAll();

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

            // Secure connection: verify DeviceID+Proof using the embedded Root public key.
            // If the key is missing, we simply treat the connection as non-secure.
            _ = Task.Run(async () =>
            {
                try
                {
                    var ok = await VerifySecureIdentityAsync(timeoutMs: 900);
                    RunOnUi(() =>
                    {
                        IsSecureConnected = ok;
                    });
                }
                catch
                {
                    RunOnUi(() => { IsSecureConnected = false; });
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
        IsSecureConnected = false;
        SecureDeviceIdHex = null;
        SecureDeviceIdB64 = null;
        SecureDeviceProofB64 = null;

        // Keep parity with iOS/macOS: avoid stale capture across sessions.
        NativeBufferRust.ClearAll();
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

    internal sealed record DeviceIdentity(byte[] DeviceId, byte[] Proof)
    {
        internal string DeviceIdB64 => Convert.ToBase64String(DeviceId);
        internal string ProofB64 => Convert.ToBase64String(Proof);
        internal string DeviceIdHex => BitConverter.ToString(DeviceId).Replace("-", "").ToLowerInvariant();
    }

    internal async Task<DeviceIdentity?> ReadDeviceIdentityAsync(int timeoutMs)
    {
        // Read DeviceID.
        var devLane = await SendCommandAsync(
            commandLane: new byte[] { EmwOpcode.IdentityGet, 0x00, 0x00 },
            timeoutMs: timeoutMs,
            responsePredicate: lane18 => lane18.Length >= 17 && lane18[0] == 0x80
        );

        if (devLane == null || devLane.Length < 17 || devLane[0] != 0x80)
        {
            return null;
        }

        var deviceId = devLane.Skip(1).Take(16).ToArray();

        // Read Proof in 4 chunks (16B each).
        var proof = new byte[64];
        for (int chunk = 0; chunk < 4; chunk++)
        {
            var lane = await SendCommandAsync(
                commandLane: new byte[] { EmwOpcode.IdentityGet, 0x01, (byte)chunk },
                timeoutMs: timeoutMs,
                responsePredicate: lane18 => lane18.Length >= 17 && lane18[0] == 0x80
            );

            if (lane == null || lane.Length < 17 || lane[0] != 0x80)
            {
                return null;
            }

            System.Buffer.BlockCopy(lane, 1, proof, chunk * 16, 16);
        }

        return new DeviceIdentity(deviceId, proof);
    }

    private async Task<bool> VerifySecureIdentityAsync(int timeoutMs)
    {
        var pkRaw = EMWaver.Services.Security.EmwaverRootKey.GetPublicKeyRaw();
        if (pkRaw == null || pkRaw.Length != 32)
        {
            return false;
        }

        var ident = await ReadDeviceIdentityAsync(timeoutMs);
        if (ident == null) return false;

        if (!VerifyEd25519(pkRaw, ident.DeviceId, ident.Proof))
        {
            return false;
        }

        RunOnUi(() =>
        {
            SecureDeviceIdHex = ident.DeviceIdHex;
            SecureDeviceIdB64 = ident.DeviceIdB64;
            SecureDeviceProofB64 = ident.ProofB64;
        });

        return true;
    }

    private static bool VerifyEd25519(byte[] pkRaw32, byte[] message, byte[] signature64)
    {
        try
        {
            var pk = new Org.BouncyCastle.Crypto.Parameters.Ed25519PublicKeyParameters(pkRaw32, 0);
            var verifier = new Org.BouncyCastle.Crypto.Signers.Ed25519Signer();
            verifier.Init(false, pk);
            verifier.BlockUpdate(message, 0, message.Length);
            return verifier.VerifySignature(signature64);
        }
        catch
        {
            return false;
        }
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
                Debug.WriteLine("[EMWaver][MIDI][RX] sysEx rawData decode failed (null)");
                return;
            }

            Debug.WriteLine($"[EMWaver][MIDI][RX] sysex={bytes.Length}");

            var superframe = UsbMidiSysex.DecodeSysexToSuperframe(bytes);
            if (superframe == null || superframe.Length != SuperframeSizeBytes)
            {
                Debug.WriteLine("[EMWaver][MIDI][RX] decode superframe failed");
                return;
            }

            Debug.WriteLine($"[EMWaver][MIDI][RX] superframe36 ok cmd0=0x{superframe[0]:X2}");

            var tsMs = NowMs();
            var cmdLane = superframe.Take(LaneSizeBytes).ToArray();
            var streamLane = superframe.Skip(LaneSizeBytes).Take(LaneSizeBytes).ToArray();

            if (!IsAllZero(cmdLane))
            {
                NativeBufferRust.StoreBulkPkt(cmdLane, tsMs);
                HandleLane(cmdLane);
            }
            if (!IsAllZero(streamLane))
            {
                NativeBufferRust.StoreBulkPkt(streamLane, tsMs);
                HandleLane(streamLane);
            }
        }
        catch
        {
            // Ignore RX parse errors; transport should be resilient.
        }
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
            responsePredicate: lane18 => lane18.Length > 0 && (lane18[0] == 0x80 || lane18[0] == 0x81)
        );
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

        // Log TX for buffer parity/debugging (Rust buffer core chunks to 18B packets).
        NativeBufferRust.AppendTxBytes(superframe36, NowMs());

        // Debug log (visible in Visual Studio Output -> Debug).
        Debug.WriteLine($"[EMWaver][MIDI][TX] superframe36={superframe36.Length} sysex={sysex.Length} cmd0=0x{superframe36[0]:X2}");

        var msg = new MidiSystemExclusiveMessage(BufferFromBytes(sysex));
        _outPort.SendMessage(msg);
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
