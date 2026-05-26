using System;
using System.Linq;
using EMWaver.Interop;
using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

public sealed class DeviceBufferSessionTests
{
    [Fact]
    public void SeparateSessionsKeepRxBuffersAndCountersIsolated()
    {
        var usb = new DeviceBufferSession("usb:test");
        var ble = new DeviceBufferSession("ble:test");

        var usbPacket = Packet(0x11);
        var blePacket = Packet(0x22);

        usb.StoreBulkPkt(usbPacket, 100);
        ble.StoreBulkPkt(blePacket, 200);

        Assert.Equal((ulong)1, usb.GetRxPacketCount());
        Assert.Equal((ulong)1, ble.GetRxPacketCount());
        Assert.Equal(usbPacket, usb.GetRxSnapshot());
        Assert.Equal(blePacket, ble.GetRxSnapshot());

        var usbNext = usb.NextRxPacket();
        Assert.NotNull(usbNext);
        Assert.Equal(usbPacket, usbNext.Value.packet);
        Assert.Null(usb.NextRxPacket());

        var bleNext = ble.NextRxPacket();
        Assert.NotNull(bleNext);
        Assert.Equal(blePacket, bleNext.Value.packet);
    }

    [Fact]
    public void SeparateSessionsKeepSysexParserStateIsolated()
    {
        var usb = new DeviceBufferSession("usb:test");
        var ble = new DeviceBufferSession("ble:test");

        var usbCommand = Packet(0x33);
        var bleCommand = Packet(0x44);
        var emptyStream = new byte[NativeBufferRust.PacketSizeBytes];

        var usbSysex = UsbMidiSysex.EncodeSuperframe(Superframe(usbCommand, emptyStream));
        var bleSysex = UsbMidiSysex.EncodeSuperframe(Superframe(bleCommand, emptyStream));

        Assert.NotNull(usbSysex);
        Assert.NotNull(bleSysex);

        usb.FeedSysexBytes(usbSysex!, 300);
        ble.FeedSysexBytes(bleSysex!, 400);

        Assert.Equal((ulong)1, usb.GetRxPacketCount());
        Assert.Equal((ulong)1, ble.GetRxPacketCount());
        Assert.Equal(usbCommand, usb.NextRxPacket()!.Value.packet);
        Assert.Equal(bleCommand, ble.NextRxPacket()!.Value.packet);
    }

    [Fact]
    public void SeparateSessionsKeepTxBuffersIsolated()
    {
        var usb = new DeviceBufferSession("usb:test");
        var ble = new DeviceBufferSession("ble:test");

        var usbPacket = Packet(0x55);
        var blePacket = Packet(0x66);

        usb.AppendTxBytes(usbPacket, 500);
        ble.AppendTxBytes(blePacket, 600);

        Assert.Equal((ulong)1, usb.GetTxPacketCount());
        Assert.Equal((ulong)1, ble.GetTxPacketCount());
        Assert.Equal(usbPacket, usb.GetTxSnapshot());
        Assert.Equal(blePacket, ble.GetTxSnapshot());
    }

    [Fact]
    public void SysexParserAcceptsBlePaddedNotifications()
    {
        var session = new DeviceBufferSession("ble:test");
        var command = Packet(0x77);
        var emptyStream = new byte[NativeBufferRust.PacketSizeBytes];
        var sysex = UsbMidiSysex.EncodeSuperframe(Superframe(command, emptyStream));

        Assert.NotNull(sysex);
        var padded = new byte[64];
        Array.Copy(sysex!, padded, sysex!.Length);

        session.FeedSysexBytes(padded, 700);

        Assert.Equal((ulong)1, session.GetRxPacketCount());
        Assert.Equal(command, session.NextRxPacket()!.Value.packet);
    }

    private static byte[] Packet(byte value)
    {
        return Enumerable.Repeat(value, NativeBufferRust.PacketSizeBytes).ToArray();
    }

    private static byte[] Superframe(byte[] commandLane, byte[] streamLane)
    {
        var superframe = new byte[NativeBufferRust.PacketSizeBytes * 2];
        Array.Copy(commandLane, 0, superframe, 0, NativeBufferRust.PacketSizeBytes);
        Array.Copy(streamLane, 0, superframe, NativeBufferRust.PacketSizeBytes, NativeBufferRust.PacketSizeBytes);
        return superframe;
    }
}
