using System;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal interface ITransportDeviceSession
{
    string DeviceId { get; }

    void ClearAll();
    ulong GetRxPacketCount();
    ulong GetTxPacketCount();
    void StoreBulkPkt(byte[] data, ulong tsMs);
    void AppendTxBytes(byte[] data, ulong tsMs);
    byte[] GetRxSnapshot();
    byte[] GetTxSnapshot();
    (byte[] packet, ulong tsMs)? NextRxPacket();
    void SetRxCounterToEnd();
    void FeedSysexBytes(byte[] bytes, ulong tsMs);
    TaskCompletionSource<byte[]?> BeginResponseWait(Func<byte[], bool> predicate);
    void CompleteResponseIfMatch(byte[] lane18);
    void ClearResponseWait(TaskCompletionSource<byte[]?> tcs);
    void CancelResponseWait();
}

internal interface ITransportDeviceConnection
{
    string SessionId { get; }
    string DisplayName { get; }
    ITransportDeviceSession Session { get; }
}
