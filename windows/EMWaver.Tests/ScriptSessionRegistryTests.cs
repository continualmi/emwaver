using EMWaver.Models;
using Xunit;

namespace EMWaver.Tests;

public sealed class ScriptSessionRegistryTests
{
    [Fact]
    public void KeepsMultipleVisibleSessionsAndStopsOne()
    {
        var registry = new ScriptSessionRegistry();
        var firstStops = 0;
        var secondStops = 0;

        var first = registry.Start("Alpha", "USB A", "usb:a", "session-a", () => firstStops++);
        var second = registry.Start("Beta", "USB B", "usb:b", "session-b", () => secondStops++);

        Assert.True(registry.HasSessions);
        Assert.Equal(second.InstanceId, registry.SelectedSession?.InstanceId);
        Assert.Equal(new[] { first.InstanceId, second.InstanceId }, registry.Sessions.Select(s => s.InstanceId));

        registry.Stop(first.InstanceId);

        Assert.Equal(1, firstStops);
        Assert.Equal(0, secondStops);
        Assert.Single(registry.Sessions);
        Assert.Equal(second.InstanceId, registry.SelectedSession?.InstanceId);
        Assert.Equal("usb:b", registry.SelectedSession?.DeviceId);
        Assert.Equal("Beta.emw", registry.SelectedSession?.FileName);
        Assert.Equal("running on USB B", registry.SelectedSession?.StatusLabel);
        Assert.True(registry.SelectedSession?.IsRunning);
    }

    [Fact]
    public void SelectedFallsBackToPreviousSessionAfterStop()
    {
        var registry = new ScriptSessionRegistry();
        var firstStops = 0;
        var secondStops = 0;

        var first = registry.Start("Alpha", "USB A", "usb:a", "session-a", () => firstStops++);
        var second = registry.Start("Beta", "USB B", "usb:b", "session-b", () => secondStops++);

        registry.Stop(second.InstanceId);

        Assert.Equal(0, firstStops);
        Assert.Equal(1, secondStops);
        Assert.Equal(first.InstanceId, registry.SelectedSession?.InstanceId);

        registry.StopSelected();

        Assert.Equal(1, firstStops);
        Assert.False(registry.HasSessions);
        Assert.Null(registry.SelectedSession);
    }

    [Fact]
    public void ClearStopsAllOwnedSessionRuntimes()
    {
        var registry = new ScriptSessionRegistry();
        var stops = 0;

        registry.Start("Alpha", "USB A", "usb:a", "session-a", () => stops++);
        registry.Start("Beta", "USB B", "usb:b", "session-b", () => stops++);

        registry.Clear();

        Assert.Equal(2, stops);
        Assert.False(registry.HasSessions);
    }

    [Fact]
    public void StopSelectedRuntimeKeepsStoppedSessionVisible()
    {
        var registry = new ScriptSessionRegistry();
        var stops = 0;

        var first = registry.Start("Alpha", "USB A", "usb:a", "session-a", () => stops++);

        registry.StopSelectedRuntime();
        var second = registry.Start("Beta", "USB B", "usb:b", "session-b", () => stops++);

        Assert.Equal(1, stops);
        Assert.Equal(second.InstanceId, registry.SelectedSession?.InstanceId);
        Assert.Equal(new[] { first.InstanceId, second.InstanceId }, registry.Sessions.Select(s => s.InstanceId));
        Assert.Equal("stopped on USB A", registry.Sessions[0].StatusLabel);
        Assert.Equal("running on USB B", registry.Sessions[1].StatusLabel);
        Assert.False(registry.Sessions[0].IsRunning);
        Assert.True(registry.Sessions[1].IsRunning);

        registry.Stop(first.InstanceId);

        Assert.Equal(1, stops);
        Assert.Single(registry.Sessions);
    }
}
