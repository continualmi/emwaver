namespace EMWaver.Services;

internal sealed class TransportDeviceConnectionState
{
    private ActiveDeviceTarget _target = ActiveDeviceTarget.None;

    internal ITransportDeviceConnection? Connection { get; private set; }

    internal ActiveDeviceTarget SetTarget(string deviceId, DeviceTransport transport)
    {
        var target = new ActiveDeviceTarget(deviceId, transport);
        _target = target;
        Connection = null;
        return target;
    }

    internal void SetConnection(ITransportDeviceConnection? connection)
    {
        Connection = connection;
    }

    internal void Clear()
    {
        _target = ActiveDeviceTarget.None;
        Connection = null;
    }

    internal void Clear(DeviceTransport transport)
    {
        if (MatchesTransport(transport))
        {
            Clear();
        }
    }

    internal string CurrentScriptDeviceId => Connection?.SessionId ?? _target.DeviceId;

    internal DeviceTransport Transport => _target.Transport;

    internal bool MatchesDeviceId(string? deviceId) => _target.MatchesDeviceId(deviceId);

    internal bool MatchesTransport(DeviceTransport transport) => _target.MatchesTransport(transport);
}
