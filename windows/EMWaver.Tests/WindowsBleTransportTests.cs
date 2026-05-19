using EMWaver.Services;
using Xunit;

namespace EMWaver.Tests;

#if WINDOWS
public sealed class WindowsBleTransportTests
{
    [Fact]
    public void CloseHandlesOwnsCompositeShutdown()
    {
        var scan = new CloseProbe();
        var connection = new CloseProbe();

        WindowsBleTransport.CloseHandles(scan, null, connection);

        Assert.True(scan.Closed);
        Assert.True(connection.Closed);
    }

    private sealed class CloseProbe : IDisposable
    {
        internal bool Closed { get; private set; }

        public void Dispose()
        {
            Closed = true;
        }
    }
}
#endif
