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
}
