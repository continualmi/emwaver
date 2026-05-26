using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

public sealed class FirmwareUpdateManager : INotifyPropertyChanged
{
    private sealed record EspSerialPortCandidate(string Port, bool IsEspressifUsb, bool IsUsbSerial);
    private sealed record EspBootloaderDetection(string Port, string? BoardType);
    private sealed record EspFlashTarget(string Port, bool AlreadyInBootloader);
    private sealed record EspFirmwareAssets(
        string Chip,
        string BootloaderOffset,
        string FlashFrequency,
        string Bootloader,
        string PartitionTable,
        string OtaData,
        string App);

    private System.Windows.Threading.Dispatcher? _ui;
    private Timer? _dfuPollTimer;
    private readonly List<string> _logLines = new();
    private readonly List<string> _espHelperRawLines = new();
    private readonly SemaphoreSlim _presenceRefreshLock = new(1, 1);

    // Multi-partition progress tracking
    private long _espTotalFlashBytes;
    private long _espBootloaderSize;
    private long _espPartitionTableSize;
    private long _espOtaDataSize;
    private long _espAppSize;

    private bool _dfuConnected;
    internal bool DfuConnected
    {
        get => _dfuConnected;
        private set
        {
            if (_dfuConnected == value) return;
            _dfuConnected = value;
            OnPropertyChanged();
        }
    }

    private bool _espBootloaderConnected;
    internal bool EspBootloaderConnected
    {
        get => _espBootloaderConnected;
        private set
        {
            if (_espBootloaderConnected == value) return;
            _espBootloaderConnected = value;
            OnPropertyChanged();
        }
    }

    private string? _espBootloaderPort;
    internal string? EspBootloaderPort
    {
        get => _espBootloaderPort;
        private set
        {
            if (_espBootloaderPort == value) return;
            _espBootloaderPort = value;
            OnPropertyChanged();
        }
    }

    private string? _espDetectionError;
    internal string? EspDetectionError
    {
        get => _espDetectionError;
        private set
        {
            if (_espDetectionError == value) return;
            _espDetectionError = value;
            OnPropertyChanged();
        }
    }

    private string? _presentedBoardType;
    internal string? PresentedBoardType
    {
        get => _presentedBoardType;
        private set
        {
            if (_presentedBoardType == value) return;
            _presentedBoardType = value;
            OnPropertyChanged();
        }
    }

    private bool _isFlashing;
    internal bool IsFlashing
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
    internal double ProgressPct
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
    internal string ProgressMessage
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
    internal string? UpdateError
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
    internal bool UpdateDone
    {
        get => _updateDone;
        private set
        {
            if (_updateDone == value) return;
            _updateDone = value;
            OnPropertyChanged();
        }
    }

    private string _completionMessage = "Update complete. Reconnect the device to use it.";
    internal string CompletionMessage
    {
        get => _completionMessage;
        private set
        {
            if (_completionMessage == value) return;
            _completionMessage = value;
            OnPropertyChanged();
        }
    }

    internal string LogText => string.Join(Environment.NewLine, _logLines);

    internal void AttachUiDispatcher(System.Windows.Threading.Dispatcher ui)
    {
        _ui = ui;

        if (_dfuPollTimer != null) return;
        _dfuPollTimer = new Timer(_ => _ = RefreshDfuPresenceAsync(), null, dueTime: 0, period: 900);
    }

    internal void ResetForPresent(string? boardType = null)
    {
        PresentedBoardType = boardType;
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "";
        CompletionMessage = "Update complete. Reconnect the device to use it.";
        _logLines.Clear();
        OnPropertyChanged(nameof(LogText));
    }

    internal void ClearEspBootloaderPresence()
    {
        if (!EspBootloaderConnected && string.IsNullOrWhiteSpace(EspBootloaderPort) && string.IsNullOrWhiteSpace(EspDetectionError))
        {
            return;
        }

        EspBootloaderPort = null;
        EspDetectionError = null;
        EspBootloaderConnected = false;
    }

    internal async Task RefreshDfuPresenceAsync(bool includeEspSerialProbe = false)
    {
        if (IsFlashing) return;
        if (!await _presenceRefreshLock.WaitAsync(0)) return;

        try
        {
            bool dfuPresent;
            try
            {
                dfuPresent = await IsDfuPresentAsync();
            }
            catch
            {
                dfuPresent = false;
            }

            EspBootloaderDetection? espDetection = null;
            string? espError = null;
            if (includeEspSerialProbe)
            {
                try
                {
                    espDetection = await DetectEspBootloaderAsync();
                }
                catch (Exception ex)
                {
                    espDetection = null;
                    espError = ex.Message;
                }
            }

            RunOnUi(() =>
            {
                DfuConnected = dfuPresent;

                // Match macOS: the periodic poll only checks STM DFU. ESP serial
                // probing opens the COM port and can transiently fail when repeated
                // too often, so only explicit ESP probes update/clear this state.
                if (includeEspSerialProbe)
                {
                    EspBootloaderPort = espDetection?.Port;
                    EspDetectionError = espError;
                    EspBootloaderConnected = !string.IsNullOrWhiteSpace(espDetection?.Port);
                    if (!string.IsNullOrWhiteSpace(espDetection?.Port))
                    {
                        PresentedBoardType = espDetection?.BoardType ?? PresentedBoardType ?? "esp32";
                    }
                }
            });
        }
        finally
        {
            _presenceRefreshLock.Release();
        }
    }

    internal async Task StartUpdateAsync(WindowsDeviceManager device)
    {
        ResetTransientState();
        AppendLog("Update requested");

        if (IsFlashing) return;

        if (IsEspBoardType(EffectiveBoardType(device)))
        {
            await StartEspSerialUpdateAsync(device);
            return;
        }

        if (DfuConnected)
        {
            try
            {
                await RunStmFlashAsync();
            }
            catch (Exception ex)
            {
                UpdateError = ex.Message;
                ProgressMessage = "";
            }
            return;
        }

        if (!device.IsConnected)
        {
            UpdateError = "Connect a device in Run mode, then retry the update.";
            return;
        }

        ProgressMessage = "Switching device to Update Mode...";
        AppendLog("Requesting Update Mode from Run Mode");
        device.RequestEnterUpdateMode();
        device.Disconnect();

        await WaitForDfuPresenceAsync();
        if (!DfuConnected)
        {
            UpdateError ??= "Failed to enter Update Mode (DFU not detected).";
            ProgressMessage = "";
            return;
        }

        try
        {
            await RunStmFlashAsync();
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
    }

    private async Task WaitForDfuPresenceAsync()
    {
        var detected = false;
        string? lastError = null;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(8);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                detected = await IsDfuPresentAsync();
                if (detected) break;
            }
            catch (Exception ex)
            {
                lastError = ex.Message;
            }

            await Task.Delay(250);
        }

        DfuConnected = detected;
        if (!detected)
        {
            UpdateError = lastError ?? "Failed to enter Update Mode (DFU not detected).";
        }
    }

    private void ResetTransientState()
    {
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "Preparing update...";
        CompletionMessage = "Update complete. Reconnect the device to use it.";
    }

    private async Task RunStmFlashAsync()
    {
        if (IsFlashing) return;

        RunOnUi(() =>
        {
            IsFlashing = true;
            UpdateDone = false;
            UpdateError = null;
            ProgressPct = 0;
            ProgressMessage = "";
        });

        try
        {
            var fwBytes = await File.ReadAllBytesAsync(FirmwarePath());

            SetProgress("Starting mass erase...", 0);
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            var ct = cts.Token;

            await using var dfu = await Dfu.OpenFirstAsync();
            AppendLog("DFU device opened");

            await dfu.MassEraseAsync(ct);
            SetProgress("Mass erase complete. Setting address pointer...", 2);
            await dfu.SetAddressPointerAsync(0x0800_0000, ct);

            var totalBlocks = (fwBytes.Length + Dfu.BLOCK_SIZE - 1) / Dfu.BLOCK_SIZE;
            var totalSteps = Math.Max(1, totalBlocks * 2 + 3);
            var step = 2;

            ushort blockNum = 2;
            var readBuf = new byte[Dfu.BLOCK_SIZE];

            for (int blockIndex = 0; blockIndex < totalBlocks; blockIndex++)
            {
                ct.ThrowIfCancellationRequested();

                var chunkStart = blockIndex * Dfu.BLOCK_SIZE;
                var chunkLen = Math.Min(Dfu.BLOCK_SIZE, fwBytes.Length - chunkStart);
                var oneBased = blockIndex + 1;
                SetProgress($"Writing block {blockNum} ({oneBased}/{totalBlocks})...", (step * 100.0) / totalSteps);

                var chunk = new byte[chunkLen];
                Buffer.BlockCopy(fwBytes, chunkStart, chunk, 0, chunkLen);
                await dfu.WriteBlockAsync(chunk, blockNum, chunkLen, ct);

                step += 1;
                SetProgress($"Verifying block {blockNum} ({oneBased}/{totalBlocks})...", (step * 100.0) / totalSteps);
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

            SetProgress("Flash write completed successfully.", 100);
            UpdateDone = true;
            AppendLog(CompletionMessage);
        }
        catch (Exception ex)
        {
            AppendLog($"FAILED: {ex}");
            UpdateError = ex.ToString();
        }
        finally
        {
            IsFlashing = false;
        }
    }

    private async Task StartEspSerialUpdateAsync(WindowsDeviceManager device)
    {
        try
        {
            ProgressMessage = "Preparing ESP serial update...";
            CompletionMessage = "ESP firmware update complete. Reconnect the device in Run Mode.";
            AppendLog("ESP32 update selected");
            AppendLog("ESP flashing uses the serial helper, not DFU.");
            if (device.IsConnected)
            {
                AppendLog("Run Mode remains separate from flashing; using serial port discovery.");
            }

            var boardType = EffectiveBoardType(device);
            AppendLog($"ESP board type: {boardType}");

            var target = await ResolveEspFlashTargetAsync();
            AppendLog($"ESP flash port: {target.Port}" + (target.AlreadyInBootloader ? " (bootloader already detected; skipping reset before flash)" : ""));
            await RunEspFlashAsync(target.Port, boardType, target.AlreadyInBootloader);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
    }

    private async Task<string?> DetectEspBootloaderPortAsync()
    {
        return (await DetectEspBootloaderAsync())?.Port;
    }

    private async Task<EspBootloaderDetection?> DetectEspBootloaderAsync()
    {
        var candidates = await EspFlashPortCandidatesAsync();

        foreach (var candidate in candidates)
        {
            var port = candidate.Port;
            var (code, stdout, stderr) = await RunEspHelperAndWaitAsync("chip-id", "--port", port, "--baud", "115200", "--no-stub");
            if (code == 0)
            {
                return new EspBootloaderDetection(port, BoardTypeFromEspHelperOutput(stdout + "\n" + stderr));
            }
        }

        return null;
    }

    private static string? BoardTypeFromEspHelperOutput(string output)
    {
        var text = output.ToLowerInvariant();
        if (text.Contains("esp32-s3") || text.Contains("esp32s3")) return "esp32s3";
        if (text.Contains("esp32-s2") || text.Contains("esp32s2")) return "esp32s2";
        if (text.Contains("esp32")) return "esp32";
        return null;
    }

    private async Task<List<EspSerialPortCandidate>> EspFlashPortCandidatesAsync()
    {
        var (code, stdout, stderr) = await RunEspHelperAndWaitAsync("list-ports");
        if (code != 0)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "Failed to list ESP serial ports." : stderr.Trim());
        }

        var candidates = new List<EspSerialPortCandidate>();
        foreach (var rawLine in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var line = rawLine.Trim();
            if (!line.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase)) continue;
            var port = line.Split('\t', 2)[0][5..].Trim();
            if (string.IsNullOrWhiteSpace(port)) continue;

            var isEspressifUsb = line.Contains("VID:PID=303A", StringComparison.OrdinalIgnoreCase) ||
                                  line.Contains("VID_303A", StringComparison.OrdinalIgnoreCase);
            var isUsbSerial = isEspressifUsb ||
                              line.Contains("USB", StringComparison.OrdinalIgnoreCase) ||
                              line.Contains("UART", StringComparison.OrdinalIgnoreCase) ||
                              line.Contains("CH34", StringComparison.OrdinalIgnoreCase) ||
                              line.Contains("CP210", StringComparison.OrdinalIgnoreCase);
            candidates.Add(new EspSerialPortCandidate(port, isEspressifUsb, isUsbSerial));
        }

        return candidates
            .GroupBy(c => c.Port, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderByDescending(c => c.IsEspressifUsb)
            .ThenByDescending(c => c.IsUsbSerial)
            .ToList();
    }

    private async Task<EspFlashTarget> ResolveEspFlashTargetAsync()
    {
        if (!string.IsNullOrWhiteSpace(EspBootloaderPort))
        {
            return new EspFlashTarget(EspBootloaderPort!, AlreadyInBootloader: true);
        }

        var detected = await DetectEspBootloaderPortAsync();
        if (!string.IsNullOrWhiteSpace(detected))
        {
            return new EspFlashTarget(detected!, AlreadyInBootloader: true);
        }

        var candidates = await EspFlashPortCandidatesAsync();
        if (candidates.Count == 1)
        {
            return new EspFlashTarget(candidates[0].Port, AlreadyInBootloader: false);
        }

        var espUsbPorts = candidates.Where(c => c.IsEspressifUsb).ToList();
        if (espUsbPorts.Count == 1)
        {
            return new EspFlashTarget(espUsbPorts[0].Port, AlreadyInBootloader: false);
        }

        throw new InvalidOperationException("Could not choose a unique ESP serial port. Connect only the ESP flash port, then retry.");
    }

    private async Task RunEspFlashAsync(string port, string boardType, bool alreadyInBootloader)
    {
        if (IsFlashing) return;

        var assets = EspFirmwarePaths(boardType);
        AppendLog($"ESP chip: {assets.Chip}");
        AppendLog($"ESP bootloader: {Path.GetFileName(assets.Bootloader)}");
        AppendLog($"ESP partition table: {Path.GetFileName(assets.PartitionTable)}");
        AppendLog($"ESP OTA data: {Path.GetFileName(assets.OtaData)}");
        AppendLog($"ESP app image: {Path.GetFileName(assets.App)}");

        // Compute total flash size for multi-partition progress tracking.
        _espBootloaderSize   = new FileInfo(assets.Bootloader).Length;
        _espPartitionTableSize = new FileInfo(assets.PartitionTable).Length;
        _espOtaDataSize      = new FileInfo(assets.OtaData).Length;
        _espAppSize          = new FileInfo(assets.App).Length;
        _espTotalFlashBytes  = _espBootloaderSize + _espPartitionTableSize + _espOtaDataSize + _espAppSize;
        AppendLog($"ESP total flash size: {_espTotalFlashBytes} bytes "
                  + $"(bootloader={_espBootloaderSize}, pt={_espPartitionTableSize}, ota={_espOtaDataSize}, app={_espAppSize})");

        IsFlashing = true;
        ProgressMessage = "Flashing ESP firmware...";
        ProgressPct = 0;
        _espHelperRawLines.Clear();

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = EspHelperPath(),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("flash");
            psi.ArgumentList.Add("--chip");
            psi.ArgumentList.Add(assets.Chip);
            psi.ArgumentList.Add("--port");
            psi.ArgumentList.Add(port);
            psi.ArgumentList.Add("--baud");
            psi.ArgumentList.Add("460800");
            psi.ArgumentList.Add("--before");
            psi.ArgumentList.Add(alreadyInBootloader ? "no-reset" : "default-reset");
            psi.ArgumentList.Add("--after");
            psi.ArgumentList.Add("hard-reset");
            psi.ArgumentList.Add("--bootloader-offset");
            psi.ArgumentList.Add(assets.BootloaderOffset);
            psi.ArgumentList.Add("--flash-freq");
            psi.ArgumentList.Add(assets.FlashFrequency);
            psi.ArgumentList.Add("--bootloader");
            psi.ArgumentList.Add(assets.Bootloader);
            psi.ArgumentList.Add("--partition-table");
            psi.ArgumentList.Add(assets.PartitionTable);
            psi.ArgumentList.Add("--ota-data");
            psi.ArgumentList.Add(assets.OtaData);
            psi.ArgumentList.Add("--app");
            psi.ArgumentList.Add(assets.App);

            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            process.OutputDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                _espHelperRawLines.Add(e.Data);
                RunOnUi(() =>
                {
                    AppendLog(e.Data);
                    MaybeIngestEspProgress(e.Data);
                });
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                _espHelperRawLines.Add(e.Data);
                RunOnUi(() =>
                {
                    AppendLog(e.Data);
                    MaybeIngestEspProgress(e.Data);
                });
            };

            if (!process.Start())
            {
                throw new InvalidOperationException("Failed to start the ESP flashing helper.");
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
            {
                var helperOutput = string.Join("\n", _espHelperRawLines);
                if (helperOutput.Contains("Connecting", StringComparison.OrdinalIgnoreCase) ||
                    helperOutput.Contains("Failed to connect", StringComparison.OrdinalIgnoreCase) ||
                    helperOutput.Contains("Wrong boot mode", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"ESP bootloader did not answer on {port}. Hold BOOT, tap RESET, keep BOOT held until flashing starts, then retry. " +
                        "If Refresh already detected the bootloader, Windows will now flash without toggling reset first.");
                }

                throw new InvalidOperationException("ESP flashing helper failed. See activity log for details.");
            }

            ProgressPct = 100;
            ProgressMessage = "";
            UpdateDone = true;
            AppendLog(CompletionMessage);
        }
        finally
        {
            IsFlashing = false;
        }
    }

    private void MaybeIngestEspProgress(string line)
    {
        // Connecting phase: 0-10%
        if (line.Contains("Connecting", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, 10);
            return;
        }

        // Erasing phase: slight bump per erase
        if (line.Contains("Erasing flash", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, ProgressPct + 1);
            return;
        }

        // esptool emits "Writing at 0xXXXXXXXX [===...  ]  XX.X% NNN/total bytes..."
        // We have 4 partitions: bootloader@0x0, pt@0x8000, ota@0x10000, app@0x20000.
        if (line.Contains("Writing at", StringComparison.OrdinalIgnoreCase) && _espTotalFlashBytes > 0)
        {
            // Parse the hex address: "Writing at 0xXXXXXXXX"
            var addrIdx = line.IndexOf("0x", StringComparison.OrdinalIgnoreCase);
            long addr = 0;
            if (addrIdx >= 0)
            {
                var addrEnd = addrIdx + 2;
                while (addrEnd < line.Length && IsHexDigit(line[addrEnd])) addrEnd++;
                if (addrEnd > addrIdx + 2)
                    long.TryParse(line.Substring(addrIdx + 2, addrEnd - addrIdx - 2),
                        System.Globalization.NumberStyles.HexNumber,
                        System.Globalization.CultureInfo.InvariantCulture, out addr);
            }

            // Parse bytes written: "NNN/total" after the bracket bar
            var slashIdx = line.LastIndexOf('/');
            if (slashIdx > 0)
            {
                // Walk back to find the start of the number before '/'
                var numStart = slashIdx - 1;
                while (numStart >= 0 && char.IsDigit(line[numStart])) numStart--;
                numStart++;
                if (long.TryParse(line.Substring(numStart, slashIdx - numStart), out var regionBytes))
                {
                    // Compute absolute position: region base offset + bytes written
                    // Partition layout by address order:
                    //   0x00000: bootloader  (0x00000–0x05FFF, ~21KB)
                    //   0x08000: partition-table (0x08000–0x08BFF, ~3KB)
                    //   0x10000: ota-data    (0x10000–0x11FFF, ~8KB)
                    //   0x20000: app         (0x20000–0x141FFF, ~1.18MB)
                    long absolutePosition;
                    if (addr >= 0x20000)
                        absolutePosition = _espBootloaderSize + _espPartitionTableSize + _espOtaDataSize + (addr - 0x20000) + regionBytes;
                    else if (addr >= 0x10000)
                        absolutePosition = _espBootloaderSize + _espPartitionTableSize + (addr - 0x10000) + regionBytes;
                    else if (addr >= 0x08000)
                        absolutePosition = _espBootloaderSize + (addr - 0x08000) + regionBytes;
                    else
                        absolutePosition = addr + regionBytes;

                    var overall = 10.0 + (absolutePosition / (double)_espTotalFlashBytes) * 80.0;
                    ProgressPct = Math.Max(ProgressPct, Math.Min(90.0, overall));
                }
            }
            else
            {
                // No byte count — at least bump past the erase phase.
                ProgressPct = Math.Max(ProgressPct, 20);
            }
            return;
        }

        // Verification/hard reset: 90%
        if (line.Contains("Hash of data verified", StringComparison.OrdinalIgnoreCase) ||
            line.Contains("Hard resetting", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, 90);
        }
    }

    private static bool IsHexDigit(char c) =>
        (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');

    private async Task<(int Code, string Stdout, string Stderr)> RunEspHelperAndWaitAsync(params string[] arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = EspHelperPath(),
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        foreach (var argument in arguments)
        {
            psi.ArgumentList.Add(argument);
        }

        using var process = new Process { StartInfo = psi };
        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start the ESP helper.");
        }

        var stdout = await process.StandardOutput.ReadToEndAsync();
        var stderr = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode, stdout, stderr);
    }

    private string EspHelperPath()
    {
        var appBase = AppContext.BaseDirectory;
        var bundled = Path.Combine(appBase, "emwaver-esp-helper", "emwaver-esp-helper.exe");
        if (File.Exists(bundled))
        {
            return bundled;
        }

        // Older preview/dev outputs used a flat helper. Keep this fallback so existing
        // local builds still work if the helper was copied manually.
        var bundledFlat = Path.Combine(appBase, "emwaver-esp-helper.exe");
        if (File.Exists(bundledFlat))
        {
            return bundledFlat;
        }

        var repo = DebugRepoRoot();
        if (repo != null)
        {
            var repoHelper = Path.Combine(repo, "tools", "emwaver-esp-helper", "dist", "emwaver-esp-helper", "emwaver-esp-helper.exe");
            if (File.Exists(repoHelper))
            {
                return repoHelper;
            }

            var repoHelperFlat = Path.Combine(repo, "tools", "emwaver-esp-helper", "dist", "emwaver-esp-helper.exe");
            if (File.Exists(repoHelperFlat))
            {
                return repoHelperFlat;
            }
        }

        throw new FileNotFoundException("Missing bundled ESP helper (emwaver-esp-helper/emwaver-esp-helper.exe).");
    }

    private EspFirmwareAssets EspFirmwarePaths(string boardType)
    {
        var normalized = NormalizedEspBoardType(boardType);
        if (normalized == null)
        {
            throw new FileNotFoundException("Unknown ESP board type for firmware flashing.");
        }

        string Require(string name)
        {
            var path = Path.Combine(AppContext.BaseDirectory, $"{name}.bin");
            if (File.Exists(path))
            {
                return path;
            }

            var repo = DebugRepoRoot();
            if (repo != null)
            {
                var repoPath = Path.Combine(repo, "firmware", name switch
                {
                    "emwaver-esp32-app" => "emwaver-esp32-app.bin",
                    "emwaver-esp32-bootloader" => "emwaver-esp32-bootloader.bin",
                    "emwaver-esp32-partition-table" => "emwaver-esp32-partition-table.bin",
                    "emwaver-esp32-ota-data" => "emwaver-esp32-ota-data.bin",
                    "emwaver-esp32s2-app" => "emwaver-esp32s2-app.bin",
                    "emwaver-esp32s2-bootloader" => "emwaver-esp32s2-bootloader.bin",
                    "emwaver-esp32s2-partition-table" => "emwaver-esp32s2-partition-table.bin",
                    "emwaver-esp32s2-ota-data" => "emwaver-esp32s2-ota-data.bin",
                    "emwaver-esp32s3-app" => "emwaver-esp32s3-app.bin",
                    "emwaver-esp32s3-bootloader" => "emwaver-esp32s3-bootloader.bin",
                    "emwaver-esp32s3-partition-table" => "emwaver-esp32s3-partition-table.bin",
                    "emwaver-esp32s3-ota-data" => "emwaver-esp32s3-ota-data.bin",
                    _ => ""
                });
                if (!string.IsNullOrWhiteSpace(repoPath) && File.Exists(repoPath))
                {
                    return repoPath;
                }
            }

            throw new FileNotFoundException($"Missing bundled ESP firmware asset ({name}.bin).");
        }

        if (normalized == "esp32")
        {
            return new EspFirmwareAssets(
                "esp32",
                "0x1000",
                "40m",
                Require("emwaver-esp32-bootloader"),
                Require("emwaver-esp32-partition-table"),
                Require("emwaver-esp32-ota-data"),
                Require("emwaver-esp32-app"));
        }

        if (normalized == "esp32s2")
        {
            return new EspFirmwareAssets(
                "esp32s2",
                "0x1000",
                "80m",
                Require("emwaver-esp32s2-bootloader"),
                Require("emwaver-esp32s2-partition-table"),
                Require("emwaver-esp32s2-ota-data"),
                Require("emwaver-esp32s2-app"));
        }

        return new EspFirmwareAssets(
            "esp32s3",
            "0x0",
            "80m",
            Require("emwaver-esp32s3-bootloader"),
            Require("emwaver-esp32s3-partition-table"),
            Require("emwaver-esp32s3-ota-data"),
            Require("emwaver-esp32s3-app"));
    }

    private static string? DebugRepoRoot()
    {
        var current = AppContext.BaseDirectory;
        for (int i = 0; i < 10 && !string.IsNullOrWhiteSpace(current); i++)
        {
            if (File.Exists(Path.Combine(current, "windows", "EMWaver", "EMWaver.csproj")) ||
                File.Exists(Path.Combine(current, "README.txt")))
            {
                return current;
            }

            var parent = Directory.GetParent(current);
            if (parent == null) break;
            current = parent.FullName;
        }

        return null;
    }

    private static string FirmwarePath()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "emwaver.bin");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("Missing bundled firmware (emwaver.bin).", path);
        }
        return path;
    }

    private static Task<bool> IsDfuPresentAsync() => Dfu.IsPresentAsync();

    private string EffectiveBoardType(WindowsDeviceManager device)
    {
        var presented = NormalizedEspBoardType(PresentedBoardType);
        if (presented != null) return presented;
        if (EspBootloaderConnected || !string.IsNullOrWhiteSpace(EspBootloaderPort)) return "esp32";
        return device.ConnectedBoardType ?? device.LastDetectedBoardType ?? "stm32f042";
    }

    private static bool IsEspBoardType(string? boardType)
    {
        return NormalizedEspBoardType(boardType) != null;
    }

    internal static string? NormalizedEspBoardType(string? boardType)
    {
        return (boardType ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "esp32" => "esp32",
            "esp32s2" or "esp32-s2" => "esp32s2",
            "esp32s3" or "esp32-s3" => "esp32s3",
            _ => null,
        };
    }

    private static string Normalize(string? value)
    {
        return (value ?? string.Empty).Trim().ToUpperInvariant();
    }

    internal IReadOnlyList<string> GetEspHelperLog() => _espHelperRawLines;

    private void SetProgress(string message, double pct)
    {
        ProgressMessage = message;
        ProgressPct = pct;
        AppendLog($"{message} ({pct:0.##}%)");
    }

    private void AppendLog(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        _logLines.Add(text.TrimEnd());
        OnPropertyChanged(nameof(LogText));
    }

    private void RunOnUi(Action fn)
    {
        var ui = _ui;
        if (ui == null || ui.CheckAccess())
        {
            fn();
            return;
        }

        ui.Invoke(fn);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
