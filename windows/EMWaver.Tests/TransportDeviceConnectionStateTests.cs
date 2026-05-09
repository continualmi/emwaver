using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

public sealed class TransportDeviceConnectionStateTests
{
    [Fact]
    public void CurrentScriptDeviceIdFollowsActiveConnectionWhenPresent()
    {
        var state = new TransportDeviceConnectionState();
        var target = state.SetTarget(" usb:target ", DeviceTransport.UsbMidi);
        var connection = new FakeConnection("usb:connection", "USB Board");

        state.SetConnection(connection);

        Assert.Equal("usb:target", target.DeviceId);
        Assert.Equal("usb:connection", state.CurrentScriptDeviceId);
        Assert.Same(connection, state.Connection);
        Assert.True(state.MatchesDeviceId("USB:TARGET"));
        Assert.True(state.MatchesTransport(DeviceTransport.UsbMidi));
    }

    [Fact]
    public void ClearingMatchingTransportDropsConnectionAndResetsTarget()
    {
        var state = new TransportDeviceConnectionState();
        state.SetTarget("ble:board", DeviceTransport.Ble);
        state.SetConnection(new FakeConnection("ble:board", "BLE Board"));

        state.Clear(DeviceTransport.UsbMidi);
        Assert.Equal("ble:board", state.CurrentScriptDeviceId);

        state.Clear(DeviceTransport.Ble);
        Assert.Equal("active", state.CurrentScriptDeviceId);
        Assert.Equal(DeviceTransport.None, state.Transport);
        Assert.False(state.MatchesDeviceId("ble:board"));
    }

    [Fact]
    public void RetainsConnectionsByDeviceIdForFutureMultiDeviceRouting()
    {
        var state = new TransportDeviceConnectionState();
        var first = new FakeConnection("usb:board-1", "USB Board 1");
        var second = new FakeConnection("ble:board-2", "BLE Board 2");

        state.SetConnection(first);
        state.SetConnection(second);

        Assert.Same(first, state.ConnectionFor(" USB:BOARD-1 "));
        Assert.Same(second, state.ConnectionFor("ble:board-2"));
        Assert.Same(second, state.Connection);
    }

    private sealed class FakeConnection : ITransportDeviceConnection
    {
        internal FakeConnection(string sessionId, string displayName)
        {
            SessionId = sessionId;
            DisplayName = displayName;
            Session = new DeviceBufferSession(sessionId);
        }

        public string SessionId { get; }
        public string DisplayName { get; }
        public ITransportDeviceSession Session { get; }
    }
}
