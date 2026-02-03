using System;
using System.Runtime.InteropServices;

namespace EMWaver.Interop;

// P/Invoke bindings for the Windows Rust FFI DLL.
//
// The DLL is produced by `crates/emwaver-buffer-windows-ffi`.
// C ABI source-of-truth: `crates/emwaver-buffer-windows-ffi/include/emwaver_buffer_windows.h`.
internal static class EmwBufferNative
{
    // For dev, copy the built DLL next to the app executable.
    private const string DllName = "emwaver_buffer_windows";

    [DllImport(DllName, EntryPoint = "emw_buffer_clear_all", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void ClearAll();

    [DllImport(DllName, EntryPoint = "emw_buffer_rx_len_bytes", CallingConvention = CallingConvention.Cdecl)]
    internal static extern nuint RxLenBytes();

    [DllImport(DllName, EntryPoint = "emw_buffer_rx_packet_count", CallingConvention = CallingConvention.Cdecl)]
    internal static extern ulong RxPacketCount();

    [DllImport(DllName, EntryPoint = "emw_buffer_tx_packet_count", CallingConvention = CallingConvention.Cdecl)]
    internal static extern ulong TxPacketCount();

    [DllImport(DllName, EntryPoint = "emw_buffer_get_rx_counter", CallingConvention = CallingConvention.Cdecl)]
    internal static extern ulong GetRxCounter();

    [DllImport(DllName, EntryPoint = "emw_buffer_set_rx_counter", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void SetRxCounter(ulong value);

    // emw_buffer_set_invert_rx removed (legacy).

    [DllImport(DllName, EntryPoint = "emw_buffer_load_rx_bytes", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void LoadRxBytes(byte[]? data, nuint len);

    [DllImport(DllName, EntryPoint = "emw_buffer_get_rx_snapshot", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void GetRxSnapshot(out IntPtr outPtr, out nuint outLen);

    [DllImport(DllName, EntryPoint = "emw_buffer_store_bulk_pkt", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void StoreBulkPkt(byte[]? data, nuint len, ulong tsMs);

    [DllImport(DllName, EntryPoint = "emw_buffer_append_tx_bytes", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void AppendTxBytes(byte[]? data, nuint len, ulong tsMs);

    [DllImport(DllName, EntryPoint = "emw_buffer_read_rx_since", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void ReadRxSince(
        ulong packetIndex,
        nuint maxPackets,
        out IntPtr outDataPtr,
        out nuint outDataLen,
        out IntPtr outTsPtr,
        out nuint outTsLen,
        out ulong outNextPacketIndex,
        out ulong outAvailablePackets);

    [DllImport(DllName, EntryPoint = "emw_buffer_read_tx_since", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void ReadTxSince(
        ulong packetIndex,
        nuint maxPackets,
        out IntPtr outDataPtr,
        out nuint outDataLen,
        out IntPtr outTsPtr,
        out nuint outTsLen,
        out ulong outNextPacketIndex,
        out ulong outAvailablePackets);

    [DllImport(DllName, EntryPoint = "emw_buffer_next_rx_packet", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    internal static extern bool NextRxPacket([Out] byte[] outPacket64, nuint outPacket64Len, out ulong outTsMs);

    [DllImport(DllName, EntryPoint = "emw_packet_make_packet64", CallingConvention = CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)]
    internal static extern bool MakePacket64(byte[]? data, nuint len, [Out] byte[] outPacket64, nuint outPacket64Len);

    [DllImport(DllName, EntryPoint = "emw_status_parse_bs", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int ParseBs(byte[]? packet64, nuint len);

    [DllImport(DllName, EntryPoint = "emw_buffer_compress_data_bits", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void CompressDataBits(
        int rangeStart,
        int rangeEnd,
        int numberBins,
        out IntPtr outTimePtr,
        out nuint outTimeLen,
        out IntPtr outDataPtr,
        out nuint outDataLen);

    [StructLayout(LayoutKind.Sequential)]
    internal struct EmwTxProfile
    {
        internal int max_packet_size;
        internal int min_packet_size;
        internal int initial_packet_size;
        internal int fixed_delay_ms;
        internal int target_buffer_level;
        internal int buffer_high_threshold;
        internal int buffer_low_threshold;
        internal int initial_fill_bytes;
        internal int nudge_band;
        internal int step_large;
        internal int step_small;
    }

    [DllImport(DllName, EntryPoint = "emw_tx_profile_default", CallingConvention = CallingConvention.Cdecl)]
    internal static extern EmwTxProfile TxProfileDefault();

    [DllImport(DllName, EntryPoint = "emw_tx_next_packet_size", CallingConvention = CallingConvention.Cdecl)]
    internal static extern int TxNextPacketSize(int bytesSent, int lastStatus, int currentPacketSize);

    [DllImport(DllName, EntryPoint = "emw_buffer_take_rx_state", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void TakeRxState(
        out IntPtr outRxBytesPtr,
        out nuint outRxBytesLen,
        out IntPtr outRxTsPtr,
        out nuint outRxTsLen,
        out ulong outRxCounter);

    [DllImport(DllName, EntryPoint = "emw_buffer_restore_rx_state", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void RestoreRxState(
        byte[]? rxBytes,
        nuint rxBytesLen,
        ulong[]? rxTsMs,
        nuint rxTsLen,
        ulong rxCounter);

    [DllImport(DllName, EntryPoint = "emw_free_u8", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void FreeU8(IntPtr ptr, nuint len);

    [DllImport(DllName, EntryPoint = "emw_free_u64", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void FreeU64(IntPtr ptr, nuint len);

    [DllImport(DllName, EntryPoint = "emw_free_f32", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void FreeF32(IntPtr ptr, nuint len);
}
