using System;
using System.Collections.Generic;

namespace EMWaver.Services;

internal sealed class TransportDeviceSessionRegistry
{
    private readonly object _lock = new();
    private readonly Dictionary<string, ITransportDeviceSession> _sessionsByDeviceId = new(StringComparer.OrdinalIgnoreCase);
    private ITransportDeviceSession _activeSession = new DeviceBufferSession("active");

    internal ITransportDeviceSession Active
    {
        get
        {
            lock (_lock)
            {
                return _activeSession;
            }
        }
    }

    internal ITransportDeviceSession Session(string deviceId)
    {
        var key = Normalize(deviceId);
        lock (_lock)
        {
            if (!_sessionsByDeviceId.TryGetValue(key, out var session))
            {
                session = new DeviceBufferSession(key);
                _sessionsByDeviceId[key] = session;
            }

            return session;
        }
    }

    internal ITransportDeviceSession Select(string deviceId, bool resetSession)
    {
        lock (_lock)
        {
            var session = Session(deviceId);
            _activeSession = session;
            if (resetSession)
            {
                session.ClearAll();
            }
            return session;
        }
    }

    private static string Normalize(string deviceId)
    {
        return string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim();
    }
}
