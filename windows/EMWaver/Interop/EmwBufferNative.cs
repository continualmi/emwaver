using System;
using System.Runtime.InteropServices;

namespace EMWaver.Interop;

// P/Invoke bindings for the Windows Rust FFI DLL.
//
// The DLL will be produced by `crates/emwaver-buffer-windows-ffi` and should export
// the same C ABI symbols used by other platforms (emw_buffer_*, emw_status_*, emw_free_*).
internal static class EmwBufferNative
{
    // For dev, copy the built DLL next to the app executable.
    private const string DllName = "emwaver_buffer_windows";

    [DllImport(DllName, EntryPoint = "emw_buffer_clear_all", CallingConvention = CallingConvention.Cdecl)]
    internal static extern void ClearAll();

    [DllImport(DllName, EntryPoint = "emw_buffer_rx_len_bytes", CallingConvention = CallingConvention.Cdecl)]
    internal static extern UIntPtr RxLenBytes();
}
