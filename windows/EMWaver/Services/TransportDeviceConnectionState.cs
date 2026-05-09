using System;
using System.Collections.Generic;

namespace EMWaver.Services;

internal sealed class TransportDeviceConnectionState
{
    private readonly Dictionary<string, ITransportDeviceConnection> _connectionsByDeviceId = new(StringComparer.OrdinalIgnoreCase);
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
        if (connection is not null)
        {
            _connectionsByDeviceId[Normalize(connection.SessionId)] = connection;
        }
    }

    internal void Clear()
    {
        _target = ActiveDeviceTarget.None;
        Connection = null;
        _connectionsByDeviceId.Clear();
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

    internal ITransportDeviceConnection? ConnectionFor(string? deviceId) =>
        _connectionsByDeviceId.TryGetValue(Normalize(deviceId), out var connection) ? connection : null;

    private static string Normalize(string? deviceId) =>
        string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim();
}
