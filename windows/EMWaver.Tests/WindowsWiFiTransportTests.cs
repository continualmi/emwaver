using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

public sealed class WindowsWiFiTransportTests
{
    [Theory]
    [InlineData(null, "wifi:active", "Wi-Fi: device")]
    [InlineData("", "wifi:active", "Wi-Fi: device")]
    [InlineData(" 192.168.4.2 ", "wifi:192.168.4.2", "Wi-Fi: 192.168.4.2")]
    public void NormalizesSessionIdentityAndDisplayName(string? hostOrDeviceId, string expectedSessionId, string expectedDisplayName)
    {
        Assert.Equal(expectedSessionId, WindowsWiFiTransport.SessionId(hostOrDeviceId));
        Assert.Equal(expectedDisplayName, WindowsWiFiTransport.DisplayName(hostOrDeviceId));
    }

    [Fact]
    public void ConnectionOwnsTransportDeviceSession()
    {
        var first = new WindowsWiFiTransport.Connection(" 192.168.4.2 ");
        var second = new WindowsWiFiTransport.Connection(" 192.168.4.3 ");

        Assert.Equal("192.168.4.2:3922", first.HostOrDeviceId);
        AssertConnectionOwnsIsolatedSession(first, "wifi:192.168.4.2:3922", "Wi-Fi: 192.168.4.2:3922", second);
    }

    [Fact]
    public void WebSocketUriValidatesManualLanHosts()
    {
        Assert.Equal("ws://192.168.4.2:3922/v1/ws", WindowsWiFiTransport.WebSocketUri("192.168.4.2", 3922)?.ToString());
        Assert.Equal("ws://emwaver-a1b2.local:3922/v1/ws", WindowsWiFiTransport.WebSocketUri("emwaver-a1b2.local", 3922)?.ToString());
        Assert.Equal("ws://[fd00::1234]:3922/v1/ws", WindowsWiFiTransport.WebSocketUri("fd00::1234", 3922)?.ToString());
        Assert.Null(WindowsWiFiTransport.WebSocketUri("ws://192.168.4.2", 3922));
        Assert.Null(WindowsWiFiTransport.WebSocketUri("192.168.4.2/path", 3922));
        Assert.Null(WindowsWiFiTransport.WebSocketUri("[fd00::1234]", 3922));
        Assert.Null(WindowsWiFiTransport.WebSocketUri("192.168.4.2", 70000));
    }

    private static void AssertConnectionOwnsIsolatedSession(
        ITransportDeviceConnection connection,
        string expectedSessionId,
        string expectedDisplayName,
        ITransportDeviceConnection isolatedFrom)
    {
        connection.Session.AppendTxBytes([0x01], 1);

        Assert.Equal(expectedSessionId, connection.SessionId);
        Assert.Equal(expectedDisplayName, connection.DisplayName);
        Assert.Equal(expectedSessionId, connection.Session.DeviceId);
        Assert.Equal(1UL, connection.Session.GetTxPacketCount());
        Assert.Equal(0UL, isolatedFrom.Session.GetTxPacketCount());
    }
}
