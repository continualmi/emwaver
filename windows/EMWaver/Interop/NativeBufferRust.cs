using System;

namespace EMWaver.Interop;

// Windows: intentionally avoid the Rust buffer-core DLL.
// This file keeps the transport buffer API surface local to the WPF app,
// and implements the minimal buffer logic in managed C#.
internal static class NativeBufferRust
{
    internal const int PacketSizeBytes = 18;

    private static readonly object _lock = new();

    // RX log
    private static byte[] _rxBytes = Array.Empty<byte>();
    private static ulong[] _rxTsMs = Array.Empty<ulong>(); // one per completed 18B packet
    private static ulong _rxCounter; // packet cursor for NextRxPacket

    // TX log (stored as padded 18B packets)
    private static byte[] _txBytes = Array.Empty<byte>();
    private static ulong[] _txTsMs = Array.Empty<ulong>(); // one per 18B packet

    internal static bool IsAvailable => true;

    internal static void ClearAll()
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

    internal static ulong GetRxPacketCount()
    {
        lock (_lock)
        {
            return (ulong)(_rxBytes.Length / PacketSizeBytes);
        }
    }

    internal static ulong GetTxPacketCount()
    {
        lock (_lock)
        {
            return (ulong)_txTsMs.Length;
        }
    }

    internal static void StoreBulkPkt(byte[] data, ulong tsMs)
    {
        if (data.Length == 0) return;

        lock (_lock)
        {
            var prevPackets = _rxBytes.Length / PacketSizeBytes;
            _rxBytes = AppendBytes(_rxBytes, data);
            var newPackets = _rxBytes.Length / PacketSizeBytes;
            var delta = newPackets - prevPackets;
            if (delta > 0)
            {
                _rxTsMs = AppendRepeated(_rxTsMs, tsMs, delta);
            }
        }
    }

    internal static void AppendTxBytes(byte[] data, ulong tsMs)
    {
        if (data.Length == 0) return;

        lock (_lock)
        {
            // Store as padded 18B packets with one timestamp per packet.
            for (var offset = 0; offset < data.Length; offset += PacketSizeBytes)
            {
                var take = Math.Min(PacketSizeBytes, data.Length - offset);
                var pkt = new byte[PacketSizeBytes];
                Array.Copy(data, offset, pkt, 0, take);
                _txBytes = AppendBytes(_txBytes, pkt);
                _txTsMs = AppendRepeated(_txTsMs, tsMs, 1);
            }
        }
    }

    internal static byte[] GetRxSnapshot()
    {
        lock (_lock)
        {
            var outBytes = new byte[_rxBytes.Length];
            Array.Copy(_rxBytes, outBytes, outBytes.Length);
            return outBytes;
        }
    }

    internal static (float[] timeValues, float[] dataValues) CompressDataBits(int rangeStart, int rangeEnd, int numberBins)
    {
        // Windows app does not currently use this.
        return (Array.Empty<float>(), Array.Empty<float>());
    }

    internal static int ParseBsStatus(byte[] packet)
    {
        // Windows app does not currently use this.
        return -1;
    }

    internal sealed class ReadPackets
    {
        internal required byte[] Data { get; init; }
        internal required ulong[] TsMs { get; init; }
        internal required ulong NextPacketIndex { get; init; }
        internal required ulong AvailablePackets { get; init; }
    }

    internal static ReadPackets ReadRxSince(ulong packetIndex, int maxPackets)
    {
        if (maxPackets <= 0)
        {
            return new ReadPackets { Data = Array.Empty<byte>(), TsMs = Array.Empty<ulong>(), NextPacketIndex = packetIndex, AvailablePackets = 0 };
        }

        lock (_lock)
        {
            var availablePackets = (ulong)(_rxBytes.Length / PacketSizeBytes);
            if (availablePackets == 0 || packetIndex >= availablePackets)
            {
                return new ReadPackets { Data = Array.Empty<byte>(), TsMs = Array.Empty<ulong>(), NextPacketIndex = Math.Min(packetIndex, availablePackets), AvailablePackets = availablePackets };
            }

            var toRead = (ulong)Math.Min(maxPackets, (int)Math.Min((ulong)int.MaxValue, availablePackets - packetIndex));
            var startByte = checked((int)packetIndex * PacketSizeBytes);
            var endByte = checked(startByte + (int)toRead * PacketSizeBytes);
            endByte = Math.Min(endByte, _rxBytes.Length);

            var data = new byte[endByte - startByte];
            Array.Copy(_rxBytes, startByte, data, 0, data.Length);

            var tsStart = (int)packetIndex;
            var tsEnd = Math.Min(_rxTsMs.Length, tsStart + (int)toRead);
            var tsLen = Math.Max(0, tsEnd - tsStart);
            var ts = new ulong[tsLen];
            if (tsLen > 0) Array.Copy(_rxTsMs, tsStart, ts, 0, tsLen);

            return new ReadPackets
            {
                Data = data,
                TsMs = ts,
                NextPacketIndex = packetIndex + toRead,
                AvailablePackets = availablePackets,
            };
        }
    }

    internal static ReadPackets ReadTxSince(ulong packetIndex, int maxPackets)
    {
        if (maxPackets <= 0)
        {
            return new ReadPackets { Data = Array.Empty<byte>(), TsMs = Array.Empty<ulong>(), NextPacketIndex = packetIndex, AvailablePackets = 0 };
        }

        lock (_lock)
        {
            var availablePackets = (ulong)_txTsMs.Length;
            if (availablePackets == 0 || packetIndex >= availablePackets)
            {
                return new ReadPackets { Data = Array.Empty<byte>(), TsMs = Array.Empty<ulong>(), NextPacketIndex = Math.Min(packetIndex, availablePackets), AvailablePackets = availablePackets };
            }

            var toRead = (ulong)Math.Min(maxPackets, (int)Math.Min((ulong)int.MaxValue, availablePackets - packetIndex));
            var startByte = checked((int)packetIndex * PacketSizeBytes);
            var endByte = checked(startByte + (int)toRead * PacketSizeBytes);
            endByte = Math.Min(endByte, _txBytes.Length);

            var data = new byte[endByte - startByte];
            Array.Copy(_txBytes, startByte, data, 0, data.Length);

            var tsStart = (int)packetIndex;
            var tsEnd = Math.Min(_txTsMs.Length, tsStart + (int)toRead);
            var tsLen = Math.Max(0, tsEnd - tsStart);
            var ts = new ulong[tsLen];
            if (tsLen > 0) Array.Copy(_txTsMs, tsStart, ts, 0, tsLen);

            return new ReadPackets
            {
                Data = data,
                TsMs = ts,
                NextPacketIndex = packetIndex + toRead,
                AvailablePackets = availablePackets,
            };
        }
    }

    internal static (byte[] packet, ulong tsMs)? NextRxPacket()
    {
        lock (_lock)
        {
            var available = (ulong)(_rxBytes.Length / PacketSizeBytes);
            if (_rxCounter >= available) return null;

            var startByte = checked((int)_rxCounter * PacketSizeBytes);
            if (startByte + PacketSizeBytes > _rxBytes.Length) return null;

            var pkt = new byte[PacketSizeBytes];
            Array.Copy(_rxBytes, startByte, pkt, 0, PacketSizeBytes);

            var ts = _rxCounter < (ulong)_rxTsMs.Length ? _rxTsMs[(int)_rxCounter] : 0;
            _rxCounter += 1;
            return (pkt, ts);
        }
    }

    internal static byte[]? MakePacket64(byte[] data)
    {
        // Despite the name, on Windows we use 18B lanes.
        if (data.Length > PacketSizeBytes) return null;
        var outPacket = new byte[PacketSizeBytes];
        Array.Copy(data, 0, outPacket, 0, data.Length);
        return outPacket;
    }

    // TX pacing helpers (not used by the Windows app right now).
    internal static EmwTxProfile TxProfileDefault() => default;
    internal static int TxNextPacketSize(int bytesSent, int lastStatus, int currentPacketSize) => currentPacketSize;

    internal static (byte[] rxBytes, ulong[] rxTsMs, ulong rxCounter) TakeRxState()
    {
        lock (_lock)
        {
            var bytes = new byte[_rxBytes.Length];
            Array.Copy(_rxBytes, bytes, bytes.Length);
            var ts = new ulong[_rxTsMs.Length];
            Array.Copy(_rxTsMs, ts, ts.Length);
            return (bytes, ts, _rxCounter);
        }
    }

    internal static void RestoreRxState(byte[] rxBytes, ulong[] rxTsMs, ulong rxCounter)
    {
        lock (_lock)
        {
            _rxBytes = rxBytes ?? Array.Empty<byte>();
            _rxTsMs = rxTsMs ?? Array.Empty<ulong>();
            _rxCounter = rxCounter;
        }
    }

    internal readonly struct EmwTxProfile
    {
        public readonly int InitialPacketSize;
        public readonly int MinPacketSize;
        public readonly int MaxPacketSize;

        public EmwTxProfile(int initialPacketSize, int minPacketSize, int maxPacketSize)
        {
            InitialPacketSize = initialPacketSize;
            MinPacketSize = minPacketSize;
            MaxPacketSize = maxPacketSize;
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
