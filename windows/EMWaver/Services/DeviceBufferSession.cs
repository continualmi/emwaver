using EMWaver.Interop;
using System;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class DeviceBufferSession
{
    private readonly object _lock = new();

    private byte[] _rxBytes = Array.Empty<byte>();
    private ulong[] _rxTsMs = Array.Empty<ulong>();
    private ulong _rxCounter;
    private byte[] _txBytes = Array.Empty<byte>();
    private ulong[] _txTsMs = Array.Empty<ulong>();
    private readonly object _responseLock = new();
    private TaskCompletionSource<byte[]?>? _responseTcs;
    private Func<byte[], bool>? _responsePredicate;

    internal string DeviceId { get; }

    internal DeviceBufferSession(string deviceId)
    {
        DeviceId = string.IsNullOrWhiteSpace(deviceId) ? "active" : deviceId;
    }

    internal void ClearAll()
    {
        lock (_lock)
        {
            _rxBytes = Array.Empty<byte>();
            _rxTsMs = Array.Empty<ulong>();
            _rxCounter = 0;
            _txBytes = Array.Empty<byte>();
            _txTsMs = Array.Empty<ulong>();
        }
    }

    internal ulong GetRxPacketCount()
    {
        lock (_lock)
        {
            return (ulong)(_rxBytes.Length / NativeBufferRust.PacketSizeBytes);
        }
    }

    internal ulong GetTxPacketCount()
    {
        lock (_lock)
        {
            return (ulong)_txTsMs.Length;
        }
    }

    internal void StoreBulkPkt(byte[] data, ulong tsMs)
    {
        if (data.Length == 0) return;

        lock (_lock)
        {
            var prevPackets = _rxBytes.Length / NativeBufferRust.PacketSizeBytes;
            _rxBytes = AppendBytes(_rxBytes, data);
            var newPackets = _rxBytes.Length / NativeBufferRust.PacketSizeBytes;
            var delta = newPackets - prevPackets;
            if (delta > 0)
            {
                _rxTsMs = AppendRepeated(_rxTsMs, tsMs, delta);
            }
        }
    }

    internal void AppendTxBytes(byte[] data, ulong tsMs)
    {
        if (data.Length == 0) return;

        lock (_lock)
        {
            for (var offset = 0; offset < data.Length; offset += NativeBufferRust.PacketSizeBytes)
            {
                var take = Math.Min(NativeBufferRust.PacketSizeBytes, data.Length - offset);
                var pkt = new byte[NativeBufferRust.PacketSizeBytes];
                Array.Copy(data, offset, pkt, 0, take);
                _txBytes = AppendBytes(_txBytes, pkt);
                _txTsMs = AppendRepeated(_txTsMs, tsMs, 1);
            }
        }
    }

    internal byte[] GetRxSnapshot()
    {
        lock (_lock)
        {
            var outBytes = new byte[_rxBytes.Length];
            Array.Copy(_rxBytes, outBytes, outBytes.Length);
            return outBytes;
        }
    }

    internal (byte[] packet, ulong tsMs)? NextRxPacket()
    {
        lock (_lock)
        {
            var available = (ulong)(_rxBytes.Length / NativeBufferRust.PacketSizeBytes);
            if (_rxCounter >= available) return null;

            var startByte = checked((int)_rxCounter * NativeBufferRust.PacketSizeBytes);
            if (startByte + NativeBufferRust.PacketSizeBytes > _rxBytes.Length) return null;

            var pkt = new byte[NativeBufferRust.PacketSizeBytes];
            Array.Copy(_rxBytes, startByte, pkt, 0, NativeBufferRust.PacketSizeBytes);

            var ts = _rxCounter < (ulong)_rxTsMs.Length ? _rxTsMs[(int)_rxCounter] : 0;
            _rxCounter += 1;
            return (pkt, ts);
        }
    }

    internal void SetRxCounterToEnd()
    {
        lock (_lock)
        {
            _rxCounter = (ulong)(_rxBytes.Length / NativeBufferRust.PacketSizeBytes);
        }
    }

    internal TaskCompletionSource<byte[]?> BeginResponseWait(Func<byte[], bool> predicate)
    {
        lock (_responseLock)
        {
            _responsePredicate = predicate;
            _responseTcs = new TaskCompletionSource<byte[]?>(TaskCreationOptions.RunContinuationsAsynchronously);
            return _responseTcs;
        }
    }

    internal void CompleteResponseIfMatch(byte[] lane18)
    {
        lock (_responseLock)
        {
            if (_responseTcs == null || _responsePredicate == null)
            {
                return;
            }
            if (!_responsePredicate(lane18))
            {
                return;
            }
            _responseTcs.TrySetResult(lane18);
        }
    }

    internal void ClearResponseWait(TaskCompletionSource<byte[]?> tcs)
    {
        lock (_responseLock)
        {
            if (!ReferenceEquals(_responseTcs, tcs))
            {
                return;
            }
            _responseTcs = null;
            _responsePredicate = null;
        }
    }

    internal void CancelResponseWait()
    {
        lock (_responseLock)
        {
            _responseTcs?.TrySetResult(null);
            _responseTcs = null;
            _responsePredicate = null;
        }
    }

    private static byte[] AppendBytes(byte[] existing, byte[] add)
    {
        if (add.Length == 0) return existing;
        if (existing.Length == 0) return (byte[])add.Clone();

        var outArr = new byte[existing.Length + add.Length];
        Array.Copy(existing, outArr, existing.Length);
        Array.Copy(add, 0, outArr, existing.Length, add.Length);
        return outArr;
    }

    private static ulong[] AppendRepeated(ulong[] existing, ulong value, int count)
    {
        if (count <= 0) return existing;
        var outArr = new ulong[existing.Length + count];
        if (existing.Length > 0) Array.Copy(existing, outArr, existing.Length);
        for (var i = 0; i < count; i++) outArr[existing.Length + i] = value;
        return outArr;
    }
}
