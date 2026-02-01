using System;
using System.Runtime.InteropServices;

namespace EMWaver.Interop;

internal static class NativeBufferRust
{
    internal const int PacketSizeBytes = 18;

    // 0 unknown, 1 available, -1 unavailable.
    private static int _availability;

    internal static bool IsAvailable
    {
        get
        {
            if (_availability == 1) return true;
            if (_availability == -1) return false;

            try
            {
                _ = EmwBufferNative.RxPacketCount();
                _availability = 1;
                return true;
            }
            catch (DllNotFoundException)
            {
                _availability = -1;
                return false;
            }
            catch (BadImageFormatException)
            {
                _availability = -1;
                return false;
            }
            catch (EntryPointNotFoundException)
            {
                _availability = -1;
                return false;
            }
        }
    }

    internal static void ClearAll()
    {
        if (!IsAvailable) return;
        EmwBufferNative.ClearAll();
    }

    internal static ulong GetRxPacketCount()
    {
        if (!IsAvailable) return 0;
        return EmwBufferNative.RxPacketCount();
    }

    internal static ulong GetTxPacketCount()
    {
        if (!IsAvailable) return 0;
        return EmwBufferNative.TxPacketCount();
    }

    internal static void StoreBulkPkt(byte[] data, ulong tsMs)
    {
        if (!IsAvailable) return;
        if (data.Length == 0) return;
        EmwBufferNative.StoreBulkPkt(data, (nuint)data.Length, tsMs);
    }

    internal static void AppendTxBytes(byte[] data, ulong tsMs)
    {
        if (!IsAvailable) return;
        if (data.Length == 0) return;
        EmwBufferNative.AppendTxBytes(data, (nuint)data.Length, tsMs);
    }

    internal static byte[] GetRxSnapshot()
    {
        if (!IsAvailable) return [];

        EmwBufferNative.GetRxSnapshot(out var ptr, out var len);
        if (ptr == IntPtr.Zero || len == 0) return [];

        if (len > int.MaxValue)
        {
            // Extremely unlikely for our use; avoid overflow.
            EmwBufferNative.FreeU8(ptr, len);
            return [];
        }

        var data = new byte[(int)len];
        Marshal.Copy(ptr, data, 0, data.Length);
        EmwBufferNative.FreeU8(ptr, len);
        return data;
    }

    internal static (float[] timeValues, float[] dataValues) CompressDataBits(int rangeStart, int rangeEnd, int numberBins)
    {
        if (!IsAvailable) return ([], []);

        EmwBufferNative.CompressDataBits(rangeStart, rangeEnd, numberBins, out var timePtr, out var timeLen, out var dataPtr, out var dataLen);

        var time = CopyAndFreeF32(timePtr, timeLen);
        var data = CopyAndFreeF32(dataPtr, dataLen);
        return (time, data);
    }

    internal static int ParseBsStatus(byte[] packet)
    {
        if (!IsAvailable) return -1;
        return EmwBufferNative.ParseBs(packet, (nuint)packet.Length);
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
        if (!IsAvailable || maxPackets <= 0)
        {
            return new ReadPackets { Data = [], TsMs = [], NextPacketIndex = packetIndex, AvailablePackets = 0 };
        }

        EmwBufferNative.ReadRxSince(
            packetIndex,
            (nuint)maxPackets,
            out var dataPtr,
            out var dataLen,
            out var tsPtr,
            out var tsLen,
            out var nextIndex,
            out var available);

        var data = CopyAndFreeU8(dataPtr, dataLen);
        var ts = CopyAndFreeU64(tsPtr, tsLen);

        return new ReadPackets { Data = data, TsMs = ts, NextPacketIndex = nextIndex, AvailablePackets = available };
    }

    internal static ReadPackets ReadTxSince(ulong packetIndex, int maxPackets)
    {
        if (!IsAvailable || maxPackets <= 0)
        {
            return new ReadPackets { Data = [], TsMs = [], NextPacketIndex = packetIndex, AvailablePackets = 0 };
        }

        EmwBufferNative.ReadTxSince(
            packetIndex,
            (nuint)maxPackets,
            out var dataPtr,
            out var dataLen,
            out var tsPtr,
            out var tsLen,
            out var nextIndex,
            out var available);

        var data = CopyAndFreeU8(dataPtr, dataLen);
        var ts = CopyAndFreeU64(tsPtr, tsLen);

        return new ReadPackets { Data = data, TsMs = ts, NextPacketIndex = nextIndex, AvailablePackets = available };
    }

    internal static (byte[] packet, ulong tsMs)? NextRxPacket()
    {
        if (!IsAvailable) return null;

        var packet = new byte[PacketSizeBytes];
        var ok = EmwBufferNative.NextRxPacket(packet, (nuint)packet.Length, out var tsMs);
        return ok ? (packet, tsMs) : null;
    }

    internal static byte[]? MakePacket64(byte[] data)
    {
        if (!IsAvailable) return null;

        var outPacket = new byte[PacketSizeBytes];
        var ok = EmwBufferNative.MakePacket64(data, (nuint)data.Length, outPacket, (nuint)outPacket.Length);
        return ok ? outPacket : null;
    }

    internal static EmwBufferNative.EmwTxProfile TxProfileDefault()
    {
        if (!IsAvailable) return default;
        return EmwBufferNative.TxProfileDefault();
    }

    internal static int TxNextPacketSize(int bytesSent, int lastStatus, int currentPacketSize)
    {
        if (!IsAvailable) return currentPacketSize;
        return EmwBufferNative.TxNextPacketSize(bytesSent, lastStatus, currentPacketSize);
    }

    internal static (byte[] rxBytes, ulong[] rxTsMs, ulong rxCounter) TakeRxState()
    {
        if (!IsAvailable) return ([], [], 0);

        EmwBufferNative.TakeRxState(out var bytesPtr, out var bytesLen, out var tsPtr, out var tsLen, out var counter);
        var bytes = CopyAndFreeU8(bytesPtr, bytesLen);
        var ts = CopyAndFreeU64(tsPtr, tsLen);
        return (bytes, ts, counter);
    }

    internal static void RestoreRxState(byte[] rxBytes, ulong[] rxTsMs, ulong rxCounter)
    {
        if (!IsAvailable) return;
        EmwBufferNative.RestoreRxState(rxBytes, (nuint)rxBytes.Length, rxTsMs, (nuint)rxTsMs.Length, rxCounter);
    }

    private static byte[] CopyAndFreeU8(IntPtr ptr, nuint len)
    {
        if (ptr == IntPtr.Zero || len == 0) return [];
        if (len > int.MaxValue)
        {
            EmwBufferNative.FreeU8(ptr, len);
            return [];
        }
        var data = new byte[(int)len];
        Marshal.Copy(ptr, data, 0, data.Length);
        EmwBufferNative.FreeU8(ptr, len);
        return data;
    }

    private static ulong[] CopyAndFreeU64(IntPtr ptr, nuint len)
    {
        if (ptr == IntPtr.Zero || len == 0) return [];
        if (len > int.MaxValue)
        {
            EmwBufferNative.FreeU64(ptr, len);
            return [];
        }

        // Marshal.Copy doesn't support ulong[] directly; copy via bytes.
        var byteLen64 = checked((int)len) * sizeof(ulong);
        var bytes = new byte[byteLen64];
        Marshal.Copy(ptr, bytes, 0, bytes.Length);
        EmwBufferNative.FreeU64(ptr, len);

        var outArr = new ulong[(int)len];
        Buffer.BlockCopy(bytes, 0, outArr, 0, bytes.Length);
        return outArr;
    }

    private static float[] CopyAndFreeF32(IntPtr ptr, nuint len)
    {
        if (ptr == IntPtr.Zero || len == 0) return [];
        if (len > int.MaxValue)
        {
            EmwBufferNative.FreeF32(ptr, len);
            return [];
        }

        var outArr = new float[(int)len];
        Marshal.Copy(ptr, outArr, 0, outArr.Length);
        EmwBufferNative.FreeF32(ptr, len);
        return outArr;
    }
}
