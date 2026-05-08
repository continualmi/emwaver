using EMWaver.Models;
using Xunit;

namespace EMWaver.Tests;

public sealed class ScriptSessionRegistryTests
{
    [Fact]
    public void KeepsMultipleVisibleSessionsAndStopsOne()
    {
        var registry = new ScriptSessionRegistry();

        var first = registry.Start("Alpha", "USB A", "usb:a", "session-a");
        var second = registry.Start("Beta", "USB B", "usb:b", "session-b");

        Assert.True(registry.HasSessions);
        Assert.Equal(second.InstanceId, registry.SelectedSession?.InstanceId);
        Assert.Equal(new[] { first.InstanceId, second.InstanceId }, registry.Sessions.Select(s => s.InstanceId));

        registry.Stop(first.InstanceId);

        Assert.Single(registry.Sessions);
        Assert.Equal(second.InstanceId, registry.SelectedSession?.InstanceId);
        Assert.Equal("usb:b", registry.SelectedSession?.DeviceId);
        Assert.Equal("Beta.emw", registry.SelectedSession?.FileName);
        Assert.Equal("running on USB B", registry.SelectedSession?.StatusLabel);
    }

    [Fact]
    public void SelectedFallsBackToPreviousSessionAfterStop()
    {
        var registry = new ScriptSessionRegistry();

        var first = registry.Start("Alpha", "USB A", "usb:a", "session-a");
        var second = registry.Start("Beta", "USB B", "usb:b", "session-b");

        registry.Stop(second.InstanceId);

        Assert.Equal(first.InstanceId, registry.SelectedSession?.InstanceId);

        registry.StopSelected();

        Assert.False(registry.HasSessions);
        Assert.Null(registry.SelectedSession);
    }
}
