using Microsoft.UI.Dispatching;
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Usb;

namespace EMWaver.Services;

internal sealed class FirmwareUpdateManager : INotifyPropertyChanged
{
    private DispatcherQueue? _ui;
    private DispatcherQueueTimer? _dfuPollTimer;

    private bool _dfuConnected;
    public bool DfuConnected
    {
        get => _dfuConnected;
        private set
        {
            if (_dfuConnected == value) return;
            _dfuConnected = value;
            OnPropertyChanged();
        }
    }

    private bool _isFlashing;
    public bool IsFlashing
    {
        get => _isFlashing;
        private set
        {
            if (_isFlashing == value) return;
            _isFlashing = value;
            OnPropertyChanged();
        }
    }

    private double _progressPct;
    public double ProgressPct
    {
        get => _progressPct;
        private set
        {
            if (Math.Abs(_progressPct - value) < 0.0001) return;
            _progressPct = value;
            OnPropertyChanged();
        }
    }

    private string _progressMessage = "";
    public string ProgressMessage
    {
        get => _progressMessage;
        private set
        {
            if (_progressMessage == value) return;
            _progressMessage = value;
            OnPropertyChanged();
        }
    }

    private string? _updateError;
    public string? UpdateError
    {
        get => _updateError;
        private set
        {
            if (_updateError == value) return;
            _updateError = value;
            OnPropertyChanged();
        }
    }

    private bool _updateDone;
    public bool UpdateDone
    {
        get => _updateDone;
        private set
        {
            if (_updateDone == value) return;
            _updateDone = value;
            OnPropertyChanged();
        }
    }

    public void AttachUiDispatcher(DispatcherQueue ui)
    {
        _ui = ui;

        if (_dfuPollTimer != null) return;

        // Some WinUI/WindowsAppSDK combos expose CreateTimer() with quirky metadata; keep it explicit.
        DispatcherQueueTimer timer = ui.CreateTimer();
        _dfuPollTimer = timer;
        _dfuPollTimer.Interval = TimeSpan.FromMilliseconds(900);
        _dfuPollTimer.IsRepeating = true;
        _dfuPollTimer.Tick += (_, __) => _ = RefreshDfuPresenceAsync();
        _dfuPollTimer.Start();

        _ = RefreshDfuPresenceAsync();
    }

    public void ResetForPresent()
    {
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "";
    }

    public async Task RefreshDfuPresenceAsync()
    {
        if (IsFlashing) return;

        try
        {
            DfuConnected = await IsDfuPresentAsync();
        }
        catch
        {
            DfuConnected = false;
        }
    }

    public async Task StartUpdateAsync(WindowsDeviceManager device)
    {
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "Preparing update...";

        if (IsFlashing) return;

        // If DFU is already present, flash immediately.
        if (DfuConnected)
        {
            await RunFlashAsync();
            return;
        }

        // Otherwise, ask the connected device to enter DFU.
        if (device.IsConnected)
        {
            ProgressMessage = "Switching device to Update Mode...";
            device.RequestEnterUpdateMode();
            device.Disconnect();
        }
        else
        {
            UpdateError = "Connect a device in Run mode, then retry the update.";
            ProgressMessage = "";
            return;
        }

        // Poll for DFU presence with a short timeout.
        var detected = false;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(8);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                detected = await IsDfuPresentAsync();
                if (detected) break;
            }
            catch
            {
                detected = false;
            }

            await Task.Delay(250);
        }

        DfuConnected = detected;

        if (!detected)
        {
            ProgressMessage = "";
            UpdateError = "Failed to enter Update Mode (DFU not detected).";
            return;
        }

        ProgressMessage = "Preparing update...";
        await RunFlashAsync();
    }

    // MARK: - Private

    private string FirmwarePath()
    {
        var p = Path.Combine(AppContext.BaseDirectory, "emwaver.bin");
        if (!File.Exists(p))
        {
            throw new FileNotFoundException("Missing bundled firmware (emwaver.bin).", p);
        }
        return p;
    }

    private static async Task<bool> IsDfuPresentAsync()
    {
        var selector = UsbDevice.GetDeviceSelector(Dfu.USB_VENDOR_ID, Dfu.USB_PRODUCT_ID);
        var devices = await DeviceInformation.FindAllAsync(selector);
        return devices.Count > 0;
    }

    private async Task RunFlashAsync()
    {
        if (IsFlashing) return;

        IsFlashing = true;
        UpdateDone = false;
        UpdateError = null;
        ProgressPct = 0;
        ProgressMessage = "";

        try
        {
            var fwPath = FirmwarePath();
            var fwBytes = await File.ReadAllBytesAsync(fwPath);

            // Mirror Android/macos messaging.
            ProgressMessage = "Starting mass erase...";
            ProgressPct = 0;

            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            var ct = cts.Token;

            await using var dfu = await Dfu.OpenFirstAsync();

            await dfu.MassEraseAsync(ct);

            ProgressMessage = "Mass erase complete. Setting address pointer...";
            ProgressPct = 2;

            await dfu.SetAddressPointerAsync(0x0800_0000, ct);

            var totalBlocks = (fwBytes.Length + Dfu.BLOCK_SIZE - 1) / Dfu.BLOCK_SIZE;
            var totalSteps = Math.Max(1, totalBlocks * 2 + 2);
            var step = 2;

            ProgressMessage = "Address pointer set. Starting flash write...";
            ProgressPct = (step * 100.0) / totalSteps;

            ushort blockNum = 2;
            var readBuf = new byte[Dfu.BLOCK_SIZE];

            for (int blockIndex = 0; blockIndex < totalBlocks; blockIndex++)
            {
                ct.ThrowIfCancellationRequested();

                var chunkStart = blockIndex * Dfu.BLOCK_SIZE;
                var chunkLen = Math.Min(Dfu.BLOCK_SIZE, fwBytes.Length - chunkStart);

                var oneBased = blockIndex + 1;
                ProgressMessage = $"Writing block {blockNum} ({oneBased}/{totalBlocks})...";
                ProgressPct = (step * 100.0) / totalSteps;

                // Slice chunk.
                var chunk = new byte[chunkLen];
                Buffer.BlockCopy(fwBytes, chunkStart, chunk, 0, chunkLen);
                await dfu.WriteBlockAsync(chunk, blockNum, chunkLen, ct);

                step += 1;
                ProgressMessage = $"Verifying block {blockNum} ({oneBased}/{totalBlocks})...";
                ProgressPct = (step * 100.0) / totalSteps;

                await dfu.ReadBlockAsync(readBuf, blockNum, chunkLen, ct);

                for (int i = 0; i < chunkLen; i++)
                {
                    if (readBuf[i] != chunk[i])
                    {
                        throw new InvalidOperationException($"Error verifying block {blockNum - 2}");
                    }
                }

                step += 1;
                blockNum += 1;
            }

            ProgressMessage = "Flash write completed successfully.";
            ProgressPct = 100;
            UpdateDone = true;
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
        }
        finally
        {
            IsFlashing = false;
        }
    }

    private void RunOnUi(Action fn)
    {
        var ui = _ui;
        if (ui == null)
        {
            fn();
            return;
        }

        if (ui.HasThreadAccess)
        {
            fn();
            return;
        }

        _ = ui.TryEnqueue(new DispatcherQueueHandler(fn));
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
