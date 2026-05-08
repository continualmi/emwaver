using System;

namespace EMWaver.Scripting;

internal sealed class TargetedScriptDeviceConnection
{
    private readonly string _deviceId;
    private readonly Func<byte[], int, string, byte[]?> _sendPacket;
    private readonly Func<string, byte[]> _getSamplerBytes;
    private readonly Action<string> _clearSamplerBuffer;

    internal TargetedScriptDeviceConnection(
        string deviceId,
        Func<byte[], int, string, byte[]?> sendPacket,
        Func<string, byte[]> getSamplerBytes,
        Action<string> clearSamplerBuffer)
    {
        _deviceId = string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId.Trim();
        _sendPacket = sendPacket;
        _getSamplerBytes = getSamplerBytes;
        _clearSamplerBuffer = clearSamplerBuffer;
    }

    internal string DeviceId => _deviceId;

    internal byte[]? SendPacket(byte[] payload, int timeoutMs)
    {
        return _sendPacket(payload, timeoutMs, _deviceId);
    }

    internal byte[] GetSamplerBytes()
    {
        return _getSamplerBytes(_deviceId);
    }

    internal void ClearSamplerBuffer()
    {
        _clearSamplerBuffer(_deviceId);
    }
}
