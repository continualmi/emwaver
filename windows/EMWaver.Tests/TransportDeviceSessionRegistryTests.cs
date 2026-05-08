using EMWaver.Interop;
using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

public sealed class TransportDeviceSessionRegistryTests
{
    [Fact]
    public void SelectWithoutResetPreservesExistingSessionBuffers()
    {
        var registry = new TransportDeviceSessionRegistry();
        var usb = registry.Select("usb:test", resetSession: true);
        var packet = Packet(0x33);
        usb.StoreBulkPkt(packet, 100);

        var selected = registry.Select("usb:test", resetSession: false);

        Assert.Same(usb, selected);
        Assert.Equal((ulong)1, selected.GetRxPacketCount());
        Assert.Equal(packet, selected.GetRxSnapshot());
    }

    [Fact]
    public void SelectWithResetClearsExistingSessionBuffers()
    {
        var registry = new TransportDeviceSessionRegistry();
        var usb = registry.Select("usb:test", resetSession: true);
        usb.StoreBulkPkt(Packet(0x44), 100);

        var selected = registry.Select("usb:test", resetSession: true);

        Assert.Same(usb, selected);
        Assert.Equal((ulong)0, selected.GetRxPacketCount());
        Assert.Empty(selected.GetRxSnapshot());
    }

    [Fact]
    public void SeparateDeviceIdsResolveToSeparateSessions()
    {
        var registry = new TransportDeviceSessionRegistry();

        var usb = registry.Session("usb:test");
        var ble = registry.Session("ble:test");

        Assert.NotSame(usb, ble);
        Assert.Equal("usb:test", usb.DeviceId);
        Assert.Equal("ble:test", ble.DeviceId);
    }

    private static byte[] Packet(byte value)
    {
        var packet = new byte[NativeBufferRust.PacketSizeBytes];
        for (var i = 0; i < packet.Length; i++)
        {
            packet[i] = value;
        }
        return packet;
    }
}
