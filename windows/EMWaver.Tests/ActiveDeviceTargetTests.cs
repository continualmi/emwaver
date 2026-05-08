using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

public sealed class ActiveDeviceTargetTests
{
    [Fact]
    public void NormalizesBlankDeviceIdToActive()
    {
        var target = new ActiveDeviceTarget("   ", DeviceTransport.None);

        Assert.Equal("active", target.DeviceId);
        Assert.True(target.MatchesDeviceId(null));
        Assert.True(target.MatchesDeviceId(""));
    }

    [Fact]
    public void MatchesTrimmedDeviceIdCaseInsensitivelyAndTransport()
    {
        var target = new ActiveDeviceTarget(" usb:Board-1 ", DeviceTransport.UsbMidi);

        Assert.Equal("usb:Board-1", target.DeviceId);
        Assert.True(target.MatchesDeviceId("USB:board-1"));
        Assert.False(target.MatchesDeviceId("ble:board-1"));
        Assert.True(target.MatchesTransport(DeviceTransport.UsbMidi));
        Assert.False(target.MatchesTransport(DeviceTransport.Ble));
    }
}
