using System;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Usb;

namespace EMWaver.Services;

// Minimal STM32 ROM DFU implementation (0483:DF11).
// Mirrors the Android DFU flow (mass erase + set address + write blocks + readback verify).
internal sealed class Dfu : IAsyncDisposable
{
    // STM32 ROM DFU
    public const ushort USB_VENDOR_ID = 0x0483;
    public const ushort USB_PRODUCT_ID = 0xDF11;

    // DFU class requests
    public const byte DFU_DETACH = 0x00;
    public const byte DFU_DNLOAD = 0x01;
    public const byte DFU_UPLOAD = 0x02;
    public const byte DFU_GETSTATUS = 0x03;
    public const byte DFU_CLRSTATUS = 0x04;
    public const byte DFU_GETSTATE = 0x05;
    public const byte DFU_ABORT = 0x06;

    // ST DFU protocol transfer size
    public const int BLOCK_SIZE = 2048;

    private readonly UsbDevice _dev;
    private readonly uint _interfaceNumber;

    private Dfu(UsbDevice dev, uint interfaceNumber)
    {
        _dev = dev;
        _interfaceNumber = interfaceNumber;
    }

    public static async Task<Dfu> OpenFirstAsync()
    {
        var selector = UsbDevice.GetDeviceSelector(USB_VENDOR_ID, USB_PRODUCT_ID);
        var devices = await DeviceInformation.FindAllAsync(selector);
        if (devices.Count == 0)
        {
            throw new InvalidOperationException("No DFU device found (0483:DF11). Ensure device is in Update Mode.");
        }

        var id = devices[0].Id;
        var dev = await UsbDevice.FromIdAsync(id);
        if (dev == null)
        {
            throw new InvalidOperationException("Failed to open DFU USB device (permission/driver/capability issue).");
        }

        var ifaceNum = dev.DefaultInterface?.InterfaceNumber ?? 0;
        return new Dfu(dev, ifaceNum);
    }

    public async ValueTask DisposeAsync()
    {
        await Task.CompletedTask;
        try { _dev.Dispose(); } catch { }
    }

    public async Task<byte[]> GetStatusAsync(CancellationToken ct)
    {
        var buf = new byte[6];
        await ControlTransferInAsync(DFU_GETSTATUS, value: 0, index: (ushort)_interfaceNumber, buf, ct, timeoutMs: 500);
        return buf;
    }

    public async Task ClearStatusAsync(CancellationToken ct)
    {
        await ControlTransferOutAsync(DFU_CLRSTATUS, value: 0, index: (ushort)_interfaceNumber, data: Array.Empty<byte>(), ct, timeoutMs: 5000);
    }

    public async Task WaitDownloadIdleAsync(CancellationToken ct)
    {
        var start = DateTimeOffset.UtcNow;
        while (true)
        {
            ct.ThrowIfCancellationRequested();

            var st = await GetStatusAsync(ct);
            var state = st[4];
            if (state == 0x02 /*dfuIDLE*/ || state == 0x05 /*dfuDNLOAD-IDLE*/)
            {
                return;
            }

            if ((DateTimeOffset.UtcNow - start).TotalMilliseconds > 3000)
            {
                throw new TimeoutException("Timeout waiting for DFU download idle.");
            }

            await ClearStatusAsync(ct);
        }
    }

    public async Task WaitUploadIdleAsync(CancellationToken ct)
    {
        var start = DateTimeOffset.UtcNow;
        while (true)
        {
            ct.ThrowIfCancellationRequested();

            var st = await GetStatusAsync(ct);
            var state = st[4];
            if (state == 0x02 /*dfuIDLE*/ || state == 0x09 /*dfuUPLOAD-IDLE*/)
            {
                return;
            }

            if ((DateTimeOffset.UtcNow - start).TotalMilliseconds > 3000)
            {
                throw new TimeoutException("Timeout waiting for DFU upload idle.");
            }

            await ClearStatusAsync(ct);
        }
    }

    private static int BwPollTimeoutMs(byte[] status6)
    {
        // bytes 1..3 = bwPollTimeout (24-bit little-endian)
        return (status6[1] & 0xFF) | ((status6[2] & 0xFF) << 8) | ((status6[3] & 0xFF) << 16);
    }

    public async Task MassEraseAsync(CancellationToken ct)
    {
        // ST extension: 0x41 = mass erase
        await WaitDownloadIdleAsync(ct);
        await ControlTransferOutAsync(DFU_DNLOAD, value: 0, index: (ushort)_interfaceNumber, data: new byte[] { 0x41 }, ct, timeoutMs: 500);

        var st = await GetStatusAsync(ct);
        var state = st[4];
        if (!(state == 0x04 /*dfuDNBUSY*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Mass erase failed (unexpected DFU state)." );
        }

        await Task.Delay(BwPollTimeoutMs(st), ct);

        st = await GetStatusAsync(ct);
        state = st[4];
        if (!(state == 0x02 /*dfuIDLE*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Mass erase failed (not idle)." );
        }
    }

    public async Task SetAddressPointerAsync(uint address, CancellationToken ct)
    {
        // ST extension: 0x21 + address LE
        var buf = new byte[5];
        buf[0] = 0x21;
        buf[1] = (byte)(address & 0xFF);
        buf[2] = (byte)((address >> 8) & 0xFF);
        buf[3] = (byte)((address >> 16) & 0xFF);
        buf[4] = (byte)((address >> 24) & 0xFF);

        await WaitDownloadIdleAsync(ct);
        await ControlTransferOutAsync(DFU_DNLOAD, value: 0, index: (ushort)_interfaceNumber, data: buf, ct, timeoutMs: 500);

        var st = await GetStatusAsync(ct);
        var state = st[4];
        if (!(state == 0x04 /*dfuDNBUSY*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Set address pointer failed (unexpected DFU state)." );
        }

        await Task.Delay(BwPollTimeoutMs(st), ct);

        st = await GetStatusAsync(ct);
        state = st[4];
        if (!(state == 0x02 /*dfuIDLE*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Set address pointer failed (not idle)." );
        }
    }

    public async Task WriteBlockAsync(byte[] data, ushort blockNum, int numBytes, CancellationToken ct)
    {
        if (numBytes < 0 || numBytes > data.Length) throw new ArgumentOutOfRangeException(nameof(numBytes));
        await WaitDownloadIdleAsync(ct);

        byte[] chunk;
        if (numBytes == data.Length)
        {
            chunk = data;
        }
        else
        {
            chunk = new byte[numBytes];
            Buffer.BlockCopy(data, 0, chunk, 0, numBytes);
        }

        await ControlTransferOutAsync(DFU_DNLOAD, value: blockNum, index: (ushort)_interfaceNumber, data: chunk, ct, timeoutMs: 3000);

        var st = await GetStatusAsync(ct);
        var state = st[4];
        if (!(state == 0x04 /*dfuDNBUSY*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Write block failed (unexpected DFU state)." );
        }

        await Task.Delay(BwPollTimeoutMs(st), ct);

        st = await GetStatusAsync(ct);
        state = st[4];
        if (!(state == 0x02 /*dfuIDLE*/ || state == 0x05 /*dfuDNLOAD-IDLE*/))
        {
            throw new InvalidOperationException("Write block failed (not idle)." );
        }
    }

    public async Task ReadBlockAsync(byte[] buffer, ushort blockNum, int numBytes, CancellationToken ct)
    {
        if (numBytes < 0 || numBytes > buffer.Length) throw new ArgumentOutOfRangeException(nameof(numBytes));
        await WaitUploadIdleAsync(ct);

        var tmp = new byte[numBytes];
        await ControlTransferInAsync(DFU_UPLOAD, value: blockNum, index: (ushort)_interfaceNumber, tmp, ct, timeoutMs: 3000);
        Buffer.BlockCopy(tmp, 0, buffer, 0, numBytes);
    }

    // --- Low-level control transfers ---

    private async Task ControlTransferOutAsync(byte request, ushort value, ushort index, byte[] data, CancellationToken ct, int timeoutMs)
    {
        var setup = new UsbSetupPacket
        {
            RequestType = new UsbControlRequestType { Direction = UsbTransferDirection.Out, Recipient = UsbControlRecipient.Interface, ControlTransferType = UsbControlTransferType.Class },
            Request = request,
            Value = value,
            Index = index,
            Length = (ushort)(data?.Length ?? 0),
        };

        var buf = (data != null && data.Length > 0) ? data.AsBuffer() : null;

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Math.Max(1, timeoutMs));

        if (buf != null)
        {
            await _dev.SendControlOutTransferAsync(setup, buf).AsTask(cts.Token);
        }
        else
        {
            await _dev.SendControlOutTransferAsync(setup).AsTask(cts.Token);
        }
    }

    private async Task ControlTransferInAsync(byte request, ushort value, ushort index, byte[] outBuf, CancellationToken ct, int timeoutMs)
    {
        var setup = new UsbSetupPacket
        {
            RequestType = new UsbControlRequestType { Direction = UsbTransferDirection.In, Recipient = UsbControlRecipient.Interface, ControlTransferType = UsbControlTransferType.Class },
            Request = request,
            Value = value,
            Index = index,
            Length = (ushort)outBuf.Length,
        };

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(Math.Max(1, timeoutMs));

        var ibuf = await _dev.SendControlInTransferAsync(setup, (uint)outBuf.Length).AsTask(cts.Token);
        ibuf.CopyTo(0, outBuf.AsBuffer(), 0, (uint)outBuf.Length);
    }
}
