using EMWaver.Scripting;
using Xunit;

namespace EMWaver.Tests;

public sealed class TargetedScriptDeviceConnectionTests
{
    [Fact]
    public void RoutesScriptIoThroughCapturedDeviceId()
    {
        string? sendDeviceId = null;
        string? getDeviceId = null;
        string? clearDeviceId = null;
        var payload = new byte[] { 0x01, 0x02 };

        var connection = new TargetedScriptDeviceConnection(
            " USB:Board-1 ",
            (bytes, timeoutMs, deviceId) =>
            {
                sendDeviceId = deviceId;
                return [0x80];
            },
            deviceId =>
            {
                getDeviceId = deviceId;
                return payload;
            },
            deviceId => clearDeviceId = deviceId
        );

        var response = connection.SendPacket(payload, 500);
        var sampler = connection.GetSamplerBytes();
        connection.ClearSamplerBuffer();

        Assert.Equal("USB:Board-1", connection.DeviceId);
        Assert.Equal("USB:Board-1", sendDeviceId);
        Assert.Equal("USB:Board-1", getDeviceId);
        Assert.Equal("USB:Board-1", clearDeviceId);
        Assert.Equal(new byte[] { 0x80 }, response);
        Assert.Equal(payload, sampler);
    }

    [Fact]
    public void RoutesBlankCapturedDeviceIdAsActive()
    {
        string? sendDeviceId = null;
        var payload = new byte[] { 0x01, 0x02 };

        var connection = new TargetedScriptDeviceConnection(
            "   ",
            (bytes, timeoutMs, deviceId) =>
            {
                sendDeviceId = deviceId;
                return [0x80];
            },
            _ => payload,
            _ => { }
        );

        _ = connection.SendPacket(payload, 500);

        Assert.Equal("active", connection.DeviceId);
        Assert.Equal("active", sendDeviceId);
    }
}
