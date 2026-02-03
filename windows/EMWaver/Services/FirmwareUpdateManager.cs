using Microsoft.UI.Dispatching;
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace EMWaver.Services;

internal sealed class FirmwareUpdateManager : INotifyPropertyChanged
{
    private DispatcherQueue? _ui;
    private DispatcherQueueTimer? _dfuPollTimer;

    private Process? _flashProcess;
    private readonly StringBuilder _stderr = new();

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

        _dfuPollTimer = ui.CreateTimer();
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
            var (code, stderr) = await RunHelperAndWaitAsync(new[] { "is-connected" }, timeoutMs: 2000);
            if (code == 0)
            {
                DfuConnected = true;
                return;
            }

            if (code == 1)
            {
                DfuConnected = false;
                return;
            }

            DfuConnected = false;
            var msg = (stderr ?? "").Trim();
            if (!string.IsNullOrWhiteSpace(msg))
            {
                UpdateError = msg;
            }
        }
        catch (Exception ex)
        {
            DfuConnected = false;
            UpdateError = ex.Message;
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
        string? lastErr = null;

        var deadline = DateTimeOffset.UtcNow.AddSeconds(8);
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                var (code, stderr) = await RunHelperAndWaitAsync(new[] { "is-connected" }, timeoutMs: 2000);
                if (code == 0)
                {
                    detected = true;
                    break;
                }
                if (code != 1)
                {
                    var msg = (stderr ?? "").Trim();
                    if (!string.IsNullOrWhiteSpace(msg)) lastErr = msg;
                }
            }
            catch (Exception ex)
            {
                lastErr = ex.Message;
            }

            await Task.Delay(250);
        }

        DfuConnected = detected;

        if (!detected)
        {
            ProgressMessage = "";
            UpdateError = lastErr ?? "Failed to enter Update Mode (DFU not detected).";
            return;
        }

        ProgressMessage = "Preparing update...";
        await RunFlashAsync();
    }

    // MARK: - Private

    private string HelperPath()
    {
        var p = Path.Combine(AppContext.BaseDirectory, "emwaver-dfu-helper.exe");
        if (!File.Exists(p))
        {
            throw new FileNotFoundException("Missing bundled DFU helper (emwaver-dfu-helper.exe).", p);
        }
        return p;
    }

    private string FirmwarePath()
    {
        var p = Path.Combine(AppContext.BaseDirectory, "emwaver.bin");
        if (!File.Exists(p))
        {
            throw new FileNotFoundException("Missing bundled firmware (emwaver.bin).", p);
        }
        return p;
    }

    private async Task<(int exitCode, string stderr)> RunHelperAndWaitAsync(string[] args, int timeoutMs)
    {
        var psi = new ProcessStartInfo
        {
            FileName = HelperPath(),
            Arguments = string.Join(" ", args),
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi };
        proc.Start();

        using var cts = new CancellationTokenSource(Math.Max(1, timeoutMs));
        var stdoutTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
        var stderrTask = proc.StandardError.ReadToEndAsync(cts.Token);

        try
        {
            await proc.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { }
            throw new TimeoutException("DFU helper timed out.");
        }

        var stderr = "";
        try { stderr = await stderrTask; } catch { }
        return (proc.ExitCode, stderr);
    }

    private async Task RunFlashAsync()
    {
        if (_flashProcess != null) return;

        IsFlashing = true;
        UpdateDone = false;
        UpdateError = null;
        ProgressPct = 0;

        _stderr.Clear();

        var fw = FirmwarePath();

        var psi = new ProcessStartInfo
        {
            FileName = HelperPath(),
            Arguments = $"flash --firmware \"{fw}\"",
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _flashProcess = proc;

        proc.OutputDataReceived += (_, e) =>
        {
            if (e.Data == null) return;
            RunOnUi(() => HandleProgressLine(e.Data));
        };

        proc.ErrorDataReceived += (_, e) =>
        {
            if (e.Data == null) return;
            _stderr.AppendLine(e.Data);
        };

        proc.Exited += (_, __) =>
        {
            var code = proc.ExitCode;
            RunOnUi(() =>
            {
                _flashProcess = null;
                IsFlashing = false;

                if (code == 0)
                {
                    ProgressPct = 100;
                    UpdateDone = true;
                    ProgressMessage = "";
                }
                else
                {
                    var msg = _stderr.ToString().Trim();
                    UpdateError = string.IsNullOrWhiteSpace(msg)
                        ? $"Firmware update failed (exit code: {code})."
                        : msg;
                }
            });

            proc.Dispose();
        };

        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            _flashProcess = null;
            IsFlashing = false;
            UpdateError = ex.Message;
        }

        await Task.CompletedTask;
    }

    private static readonly Regex PctRe = new(@"\((\d+)%\)", RegexOptions.Compiled);
    private static readonly Regex PctSuffixRe = new(@"\s*\(\d+%\)\s*$", RegexOptions.Compiled);

    private void HandleProgressLine(string line)
    {
        var trimmed = (line ?? "").Trim();
        if (string.IsNullOrWhiteSpace(trimmed)) return;

        ProgressMessage = PctSuffixRe.Replace(trimmed, "");

        var m = PctRe.Match(trimmed);
        if (m.Success && int.TryParse(m.Groups[1].Value, out var pct))
        {
            ProgressPct = Math.Max(0, Math.Min(100, pct));
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

        _ = ui.TryEnqueue(fn);
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
