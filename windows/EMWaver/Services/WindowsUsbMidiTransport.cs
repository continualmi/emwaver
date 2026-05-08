using EMWaver.Models;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Midi;
using Windows.Foundation;
using Windows.Storage.Streams;

namespace EMWaver.Services;

internal static class WindowsUsbMidiTransport
{
    internal static readonly string[] ContainerProperties = ["System.Devices.ContainerId"];

    internal sealed class Connection : ITransportDeviceConnection, IDisposable
    {
        private readonly TypedEventHandler<MidiInPort, MidiMessageReceivedEventArgs>? _receivedHandler;

        internal Connection(
            DevicePort port,
            MidiInPort? inPort,
            IMidiOutPort? outPort,
            TypedEventHandler<MidiInPort, MidiMessageReceivedEventArgs>? receivedHandler = null,
            ITransportDeviceSession? session = null)
        {
            Port = port;
            InPort = inPort;
            OutPort = outPort;
            _receivedHandler = receivedHandler;
            SessionId = WindowsUsbMidiTransport.SessionId(port);
            DisplayName = string.IsNullOrWhiteSpace(port.DisplayName) ? "USB MIDI" : port.DisplayName;
            Session = session ?? new DeviceBufferSession(SessionId);

            if (InPort != null && _receivedHandler != null)
            {
                InPort.MessageReceived += _receivedHandler;
            }
        }

        internal DevicePort Port { get; }
        internal MidiInPort? InPort { get; }
        internal IMidiOutPort? OutPort { get; }
        public string SessionId { get; }
        public string DisplayName { get; }
        public ITransportDeviceSession Session { get; }
        internal bool IsOpen => InPort != null && OutPort != null;

        internal string InferBoardType() => WindowsUsbMidiTransport.InferBoardType(DisplayName);

        internal string? SendSuperframe(byte[] superframe36, Func<byte[], IBuffer> bufferFromBytes)
        {
            return OutPort == null
                ? "Cannot send: Not connected"
                : WindowsUsbMidiTransport.SendSuperframe(OutPort, superframe36, bufferFromBytes);
        }

        public void Dispose()
        {
            try
            {
                if (InPort != null && _receivedHandler != null)
                {
                    InPort.MessageReceived -= _receivedHandler;
                }
            }
            catch
            {
                // Ignore handler detach errors.
            }

            try
            {
                InPort?.Dispose();
            }
            catch
            {
                // Ignore dispose errors.
            }

            try
            {
                OutPort?.Dispose();
            }
            catch
            {
                // Ignore dispose errors.
            }
        }
    }

    internal static string SessionId(DevicePort port) => port.InDeviceId;

    internal static async Task<IReadOnlyList<DevicePort>> ListPortsAsync()
    {
        var inDevsTask = DeviceInformation.FindAllAsync(
            MidiInPort.GetDeviceSelector(),
            ContainerProperties
        ).AsTask();
        var outDevsTask = DeviceInformation.FindAllAsync(
            MidiOutPort.GetDeviceSelector(),
            ContainerProperties
        ).AsTask();

        await Task.WhenAll(inDevsTask, outDevsTask);
        return PairPorts(inDevsTask.Result, outDevsTask.Result);
    }

    internal static async Task<(MidiInPort? InPort, IMidiOutPort? OutPort)> OpenPortsAsync(DevicePort port)
    {
        var inPortTask = MidiInPort.FromIdAsync(port.InDeviceId).AsTask();
        var outPortTask = MidiOutPort.FromIdAsync(port.OutDeviceId).AsTask();
        await Task.WhenAll(inPortTask, outPortTask);
        return (inPortTask.Result, outPortTask.Result);
    }

    internal static async Task<Connection> OpenConnectionAsync(
        DevicePort port,
        TypedEventHandler<MidiInPort, MidiMessageReceivedEventArgs>? receivedHandler = null)
    {
        var ports = await OpenPortsAsync(port);
        return new Connection(port, ports.InPort, ports.OutPort, receivedHandler);
    }

    internal static IReadOnlyList<DevicePort> PairPorts(
        IReadOnlyList<DeviceInformation> inDevices,
        IReadOnlyList<DeviceInformation> outDevices)
    {
        var outByContainerId = outDevices
            .Select(d => new { Dev = d, Cid = ContainerIdOf(d) })
            .Where(x => !string.IsNullOrWhiteSpace(x.Cid))
            .GroupBy(x => x.Cid!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Dev, StringComparer.OrdinalIgnoreCase);

        return inDevices
            .Select(i =>
            {
                var cid = ContainerIdOf(i);
                if (!string.IsNullOrWhiteSpace(cid) && outByContainerId.TryGetValue(cid!, out var o))
                {
                    return new { In = i, Out = o };
                }

                var byName = outDevices.FirstOrDefault(o => o.Name == i.Name);
                if (byName != null)
                {
                    return new { In = i, Out = byName };
                }

                var byContains = outDevices.FirstOrDefault(o =>
                    o.Name.Contains(i.Name, StringComparison.OrdinalIgnoreCase) ||
                    i.Name.Contains(o.Name, StringComparison.OrdinalIgnoreCase));

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
    }

    internal static DevicePort? ChoosePreferred(IReadOnlyList<DevicePort> ports)
    {
        return ports.FirstOrDefault(p => p.DisplayName.Contains("emwaver", StringComparison.OrdinalIgnoreCase)) ??
               ports.FirstOrDefault(p => !p.DisplayName.Contains("network", StringComparison.OrdinalIgnoreCase)) ??
               ports.FirstOrDefault();
    }

    internal static string InferBoardType(string? displayName)
    {
        var name = (displayName ?? string.Empty).ToLowerInvariant();
        if (name.Contains("esp32") || name.Contains("esp 32") || name.Contains("s3") || name.Contains("emwaver esp"))
        {
            return "esp32s3";
        }
        return "stm32f042";
    }

    internal static string? SendSuperframe(
        IMidiOutPort outPort,
        byte[] superframe36,
        Func<byte[], IBuffer> bufferFromBytes)
    {
        var sysex = UsbMidiSysex.EncodeSuperframe(superframe36);
        if (sysex == null)
        {
            return "SysEx encode failed";
        }

        Debug.WriteLine($"[EMWaver][MIDI][TX] superframe36={superframe36.Length} sysex={sysex.Length} cmd0=0x{superframe36[0]:X2}");

        var msg = new MidiSystemExclusiveMessage(bufferFromBytes(sysex));
        outPort.SendMessage(msg);
        return null;
    }

    private static string? ContainerIdOf(DeviceInformation device)
    {
        if (device.Properties == null) return null;
        if (!device.Properties.TryGetValue("System.Devices.ContainerId", out var value)) return null;
        return value?.ToString();
    }
}
