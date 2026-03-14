using EMWaver.Services.Cloud;
using EMWaver.Services.Security;
using Microsoft.UI.Dispatching;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Usb;

namespace EMWaver.Services;

internal sealed class FirmwareUpdateManager : INotifyPropertyChanged
{
    private sealed record MintResponse(
        [property: JsonPropertyName("device_id_b64")] string DeviceIdB64,
        [property: JsonPropertyName("proof_b64")] string ProofB64,
        [property: JsonPropertyName("created")] bool? Created
    );

    private sealed record EspSerialIdentity(
        string HardwareUidHex,
        string MacHex,
        int ChipRevision,
        string FeaturesHex,
        int Cores
    );

    private const uint IdentityPageAddr = 0x0800_7800;
    private const int IdentityPageSize = 1024;
    private const int DeviceIdLen = 16;
    private const int ProofLen = 64;

    private DispatcherQueue? _ui;
    private Timer? _dfuPollTimer;
    private WindowsDeviceManager.DeviceIdentity? _preservedIdentity;
    private WindowsDeviceManager.DeviceIdentity? _identityToWriteAfterFlash;
    private readonly List<string> _logLines = new();

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

    private string _lastVerificationText = "";
    internal string LastVerificationText
    {
        get => _lastVerificationText;
        private set
        {
            if (_lastVerificationText == value) return;
            _lastVerificationText = value;
            OnPropertyChanged();
        }
    }

    internal string LogText => string.Join(Environment.NewLine, _logLines);

    internal void AttachUiDispatcher(DispatcherQueue ui)
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
        LastVerificationText = "";
        _preservedIdentity = null;
        _identityToWriteAfterFlash = null;
        _logLines.Clear();
        OnPropertyChanged(nameof(LogText));
    }

    internal async Task RefreshDfuPresenceAsync()
    {
        if (IsFlashing) return;

        bool dfuPresent;
        try
        {
            dfuPresent = await IsDfuPresentAsync();
        }
        catch
        {
            dfuPresent = false;
        }

        string? espPort = null;
        try
        {
            espPort = await DetectEspBootloaderPortAsync();
        }
        catch
        {
            espPort = null;
        }

        RunOnUi(() =>
        {
            DfuConnected = dfuPresent;
            EspBootloaderPort = espPort;
            EspBootloaderConnected = !string.IsNullOrWhiteSpace(espPort);
            if (!string.IsNullOrWhiteSpace(espPort))
            {
                PresentedBoardType = "esp32s3";
            }
        });
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

        if (device.IsConnected && !device.IsSecureConnected)
        {
            UpdateError = "Firmware update blocked: device is not secured.";
            return;
        }

        _preservedIdentity = null;
        _identityToWriteAfterFlash = null;

        if (device.IsConnected && device.IsSecureConnected)
        {
            _preservedIdentity = await device.ReadDeviceIdentityAsync(timeoutMs: 900);
            if (_preservedIdentity == null)
            {
                UpdateError = "Failed to read device identity in Run Mode. Reconnect and retry.";
                return;
            }
            AppendLog("Run-mode identity captured for restore");
        }

        if (DfuConnected)
        {
            try
            {
                if (_preservedIdentity == null)
                {
                    await GateOnDfuIdentityOrFailAsync();
                }
                await RunStmFlashAsync(_identityToWriteAfterFlash ?? _preservedIdentity);
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
            if (_preservedIdentity == null)
            {
                await GateOnDfuIdentityOrFailAsync();
            }
            await RunStmFlashAsync(_identityToWriteAfterFlash ?? _preservedIdentity);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
    }

    internal async Task StartMintAndProvisionAsync(CloudAuthManager auth, WindowsDeviceManager device)
    {
        ResetTransientState();
        AppendLog("Activation requested");
        CompletionMessage = "Activation complete. Reconnect the device to use it.";
        ProgressMessage = "Reading hardware UID...";

        if (IsFlashing) return;
        if (!device.IsConnected)
        {
            UpdateError = "Activation currently requires a device connected in Run mode so Windows can read its hardware UID.";
            return;
        }
        if (device.IsSecureConnected)
        {
            UpdateError = "Device is already secured. Use Update instead.";
            return;
        }

        var token = await auth.GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false);
        if (string.IsNullOrWhiteSpace(token))
        {
            UpdateError = "Sign in to activate this device.";
            return;
        }

        var boardType = device.ConnectedBoardType ?? device.LastDetectedBoardType ?? "stm32f042";
        if (IsEspBoardType(boardType))
        {
            await StartEspClaimAndFlashAsync(auth, AppServices.AccountDevices, device);
            return;
        }

        var hardwareUid = await device.ReadHardwareUidAsync(timeoutMs: 1200);
        if (hardwareUid == null)
        {
            UpdateError = "Failed to read hardware UID from device.";
            return;
        }

        var hardwareUidHex = BitConverter.ToString(hardwareUid).Replace("-", "");
        AppendLog($"Board type: {boardType}");
        AppendLog($"Hardware UID: {hardwareUidHex}");

        MintResponse mint;
        try
        {
            mint = await MintDeviceAsync(token!, boardType, hardwareUidHex);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            return;
        }

        _identityToWriteAfterFlash = DecodeIdentity(mint.DeviceIdB64, mint.ProofB64);
        AppendLog((mint.Created ?? false) ? "Backend device claim succeeded" : "Backend device restore succeeded");
        AppendLog($"DeviceID: {mint.DeviceIdB64[..Math.Min(16, mint.DeviceIdB64.Length)]}...");
        AppendLog($"Proof: {mint.ProofB64[..Math.Min(16, mint.ProofB64.Length)]}...");

        ProgressMessage = "Switching device to Update Mode...";
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
            await RunStmFlashAsync(_identityToWriteAfterFlash);
            AppServices.AccountDevices.StoreClaimedDevice(mint.DeviceIdB64, boardType, hardwareUidHex);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
    }

    internal async Task StartEspClaimAndFlashAsync(CloudAuthManager auth, AccountDevicesService accountDevices, WindowsDeviceManager device)
    {
        ResetTransientState();
        AppendLog("ESP setup requested");
        CompletionMessage = "ESP setup complete. Reconnect the device in Run Mode.";
        ProgressMessage = "Claiming device...";

        if (IsFlashing) return;

        var token = await auth.GetValidIdTokenAsync(CancellationToken.None, interactiveSignIn: false);
        if (string.IsNullOrWhiteSpace(token))
        {
            UpdateError = "Sign in to set up this device.";
            return;
        }

        string hardwareUidHex;
        if (!string.IsNullOrWhiteSpace(device.HardwareUidHex))
        {
            hardwareUidHex = Normalize(device.HardwareUidHex);
            AppendLog("Using existing EMWaver runtime hardware UID");
            AppendLog($"Hardware UID: {hardwareUidHex}");
        }
        else if (!string.IsNullOrWhiteSpace(device.LastDetectedHardwareUidHex))
        {
            hardwareUidHex = Normalize(device.LastDetectedHardwareUidHex);
            AppendLog("Using cached ESP hardware UID");
            AppendLog($"Hardware UID: {hardwareUidHex}");
        }
        else
        {
            var identity = await ReadEspSerialIdentityAsync();
            hardwareUidHex = identity.HardwareUidHex;
            device.LastDetectedHardwareUidHex = identity.HardwareUidHex;
            device.LastDetectedBoardType = "esp32s3";
            AppendLog("Read raw ESP identity from ROM bootloader");
            AppendLog($"MAC: {identity.MacHex}");
            AppendLog($"Chip revision: {identity.ChipRevision}");
            AppendLog($"Features: {identity.FeaturesHex}");
            AppendLog($"Cores: {identity.Cores}");
            AppendLog($"Hardware UID: {identity.HardwareUidHex}");
        }

        MintResponse mint;
        try
        {
            mint = await MintDeviceAsync(token!, "esp32s3", hardwareUidHex);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            return;
        }

        AppendLog((mint.Created ?? false) ? "Backend device claim succeeded" : "Backend device restore succeeded");
        accountDevices.StoreClaimedDevice(mint.DeviceIdB64, "esp32s3", hardwareUidHex);
        await StartEspSerialUpdateAsync(device);
    }

    internal async Task VerifyRunModeIdentityAsync(WindowsDeviceManager device)
    {
        UpdateError = null;
        if (!device.IsConnected)
        {
            UpdateError = "Run Mode verification requires a connected device.";
            return;
        }

        var pk = GetRootPublicKeyOrThrow();
        var identity = await device.ReadDeviceIdentityAsync(timeoutMs: 900);
        if (identity == null)
        {
            UpdateError = "Failed to read identity via Run Mode opcode.";
            LastVerificationText = "Run Mode verification failed";
            return;
        }

        var ok = VerifyEd25519(pk, identity.DeviceId, identity.Proof);
        LastVerificationText = $"Run Mode: {(ok ? "OK" : "Invalid")} | DeviceID {identity.DeviceIdB64}";
        AppendLog(LastVerificationText);
        if (!ok)
        {
            UpdateError = "Device proof is invalid.";
        }
    }

    internal async Task VerifyUpdateModeIdentityAsync()
    {
        UpdateError = null;
        try
        {
            var (identity, ok) = await ReadUpdateModeIdentityAsync();
            LastVerificationText = identity == null
                ? "Update Mode verification failed"
                : $"Update Mode: {(ok ? "OK" : "Invalid")} | DeviceID {identity.DeviceIdB64}";
            AppendLog(LastVerificationText);
            if (!ok)
            {
                UpdateError = "Device identity proof is invalid.";
            }
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            LastVerificationText = $"Update Mode verification failed: {ex.Message}";
            AppendLog(LastVerificationText);
        }
    }

    private async Task<MintResponse> MintDeviceAsync(string idToken, string boardType, string hardwareUidHex)
    {
        var url = $"{BackendUrl.Resolve().TrimEnd('/')}/provisioning/mint";
        using var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, url);
        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", idToken);
        req.Content = new System.Net.Http.StringContent(
            JsonSerializer.Serialize(new { board_type = boardType, hardware_uid = hardwareUidHex }),
            Encoding.UTF8,
            "application/json");

        using var res = await AppServices.Http.SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(body) ? "Device claim failed." : body);
        }

        return JsonSerializer.Deserialize<MintResponse>(body) ??
            throw new InvalidOperationException("Mint response was malformed.");
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
        LastVerificationText = "";
        _preservedIdentity = null;
        _identityToWriteAfterFlash = null;
    }

    private async Task RunStmFlashAsync(WindowsDeviceManager.DeviceIdentity? identityToWriteAfterFlash)
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

            if (identityToWriteAfterFlash != null)
            {
                SetProgress("Restoring device identity...", 98);
                var page = BuildIdentityPage(identityToWriteAfterFlash.DeviceId, identityToWriteAfterFlash.Proof);
                await dfu.SetAddressPointerAsync(IdentityPageAddr, ct);
                await dfu.WriteBlockAsync(page, blockNum: 2, numBytes: page.Length, ct);
                AppendLog("Identity page restored");
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

    private async Task GateOnDfuIdentityOrFailAsync()
    {
        var (identity, ok) = await ReadUpdateModeIdentityAsync();
        if (identity == null)
        {
            throw new InvalidOperationException("Device identity page is malformed.");
        }
        if (!ok)
        {
            throw new InvalidOperationException("Device identity proof is invalid.");
        }
        _preservedIdentity = identity;
        AppendLog("DFU identity verified before update");
    }

    private async Task<(WindowsDeviceManager.DeviceIdentity? Identity, bool Ok)> ReadUpdateModeIdentityAsync()
    {
        var pk = GetRootPublicKeyOrThrow();
        await using var dfu = await Dfu.OpenFirstAsync();
        await dfu.SetAddressPointerAsync(IdentityPageAddr, CancellationToken.None);

        var buf = new byte[IdentityPageSize];
        await dfu.ReadBlockAsync(buf, blockNum: 2, numBytes: IdentityPageSize, CancellationToken.None);

        if (buf.Length < 16 ||
            buf[0] != (byte)'E' || buf[1] != (byte)'M' || buf[2] != (byte)'I' || buf[3] != (byte)'D')
        {
            throw new InvalidOperationException("Device is not secured (missing identity page).");
        }
        if (buf[4] != 1 || buf[5] != DeviceIdLen || buf[6] != ProofLen)
        {
            throw new InvalidOperationException("Device identity page is malformed.");
        }

        var deviceId = new byte[DeviceIdLen];
        var proof = new byte[ProofLen];
        Buffer.BlockCopy(buf, 16, deviceId, 0, DeviceIdLen);
        Buffer.BlockCopy(buf, 16 + DeviceIdLen, proof, 0, ProofLen);

        var identity = new WindowsDeviceManager.DeviceIdentity(deviceId, proof);
        return (identity, VerifyEd25519(pk, deviceId, proof));
    }

    private async Task StartEspSerialUpdateAsync(WindowsDeviceManager device)
    {
        try
        {
            ProgressMessage = "Preparing ESP serial update...";
            CompletionMessage = "ESP firmware update complete. Reconnect the device in Run Mode.";
            AppendLog("ESP32-S3 update selected");
            AppendLog("ESP flashing uses the serial helper, not DFU.");
            if (device.IsConnected)
            {
                AppendLog("Run Mode remains separate from flashing; using serial port discovery.");
            }

            var port = await ResolveEspFlashPortAsync();
            AppendLog($"ESP flash port: {port}");
            await RunEspFlashAsync(port);
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
    }

    private async Task<string?> DetectEspBootloaderPortAsync()
    {
        var ports = await EspFlashPortCandidatesAsync();
        var candidates = ports
            .OrderByDescending(IsPreferredEspPort)
            .ToList();

        foreach (var port in candidates)
        {
            var (code, _, _) = await RunEspHelperAndWaitAsync("chip-id", "--port", port, "--baud", "115200", "--no-stub");
            if (code == 0)
            {
                return port;
            }
        }

        return null;
    }

    private async Task<List<string>> EspFlashPortCandidatesAsync()
    {
        var (code, stdout, stderr) = await RunEspHelperAndWaitAsync("list-ports");
        if (code != 0)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "Failed to list ESP serial ports." : stderr.Trim());
        }

        var ports = new List<string>();
        foreach (var rawLine in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var line = rawLine.Trim();
            if (!line.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase)) continue;
            var port = line.Split('\t', 2)[0][5..].Trim();
            if (!string.IsNullOrWhiteSpace(port))
            {
                ports.Add(port);
            }
        }

        return ports;
    }

    private async Task<string> ResolveEspFlashPortAsync()
    {
        var detected = await DetectEspBootloaderPortAsync();
        if (!string.IsNullOrWhiteSpace(detected))
        {
            return detected!;
        }

        var ports = await EspFlashPortCandidatesAsync();
        if (ports.Count == 1)
        {
            return ports[0];
        }

        var preferred = ports.Where(IsPreferredEspPort).ToList();
        if (preferred.Count == 1)
        {
            return preferred[0];
        }

        throw new InvalidOperationException("Could not choose a unique ESP serial port. Connect only the ESP flash port, then retry.");
    }

    private static bool IsPreferredEspPort(string port)
    {
        var value = port.ToUpperInvariant();
        return value.Contains("COM", StringComparison.OrdinalIgnoreCase) ||
               value.Contains("USB") ||
               value.Contains("UART");
    }

    private async Task<EspSerialIdentity> ReadEspSerialIdentityAsync()
    {
        var port = await ResolveEspFlashPortAsync();
        AppendLog($"ESP identity port: {port}");

        var (code, stdout, stderr) = await RunEspHelperAndWaitAsync("read-identity", "--port", port, "--baud", "115200");
        if (code != 0)
        {
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "Failed to read ESP serial identity." : stderr.Trim());
        }

        string? GetValue(string key)
        {
            foreach (var rawLine in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                if (rawLine.StartsWith($"{key}=", StringComparison.Ordinal))
                {
                    return rawLine[(key.Length + 1)..].Trim();
                }
            }
            return null;
        }

        var hardwareUidHex = Normalize(GetValue("HARDWARE_UID_HEX"));
        if (hardwareUidHex.Length == 0)
        {
            throw new InvalidOperationException("ESP serial identity is missing HARDWARE_UID_HEX.");
        }

        return new EspSerialIdentity(
            hardwareUidHex,
            Normalize(GetValue("MAC")).Replace(":", "", StringComparison.Ordinal),
            int.TryParse(GetValue("CHIP_REVISION"), out var chipRevision) ? chipRevision : 0,
            Normalize(GetValue("FEATURES")),
            int.TryParse(GetValue("CORES"), out var cores) ? cores : 0);
    }

    private async Task RunEspFlashAsync(string port)
    {
        if (IsFlashing) return;

        var assets = EspFirmwarePaths();
        AppendLog($"ESP bootloader: {Path.GetFileName(assets.Bootloader)}");
        AppendLog($"ESP partition table: {Path.GetFileName(assets.PartitionTable)}");
        AppendLog($"ESP OTA data: {Path.GetFileName(assets.OtaData)}");
        AppendLog($"ESP app image: {Path.GetFileName(assets.App)}");

        IsFlashing = true;
        ProgressMessage = "Flashing ESP firmware...";
        ProgressPct = 0;

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
            psi.ArgumentList.Add("--port");
            psi.ArgumentList.Add(port);
            psi.ArgumentList.Add("--baud");
            psi.ArgumentList.Add("115200");
            psi.ArgumentList.Add("--before");
            psi.ArgumentList.Add("no_reset");
            psi.ArgumentList.Add("--after");
            psi.ArgumentList.Add("hard_reset");
            psi.ArgumentList.Add("--no-stub");
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
                RunOnUi(() =>
                {
                    AppendLog(e.Data);
                    MaybeIngestEspProgress(e.Data);
                });
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (string.IsNullOrWhiteSpace(e.Data)) return;
                RunOnUi(() => AppendLog(e.Data));
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
        if (line.Contains("Connecting", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, 10);
        }
        else if (line.Contains("Writing at", StringComparison.OrdinalIgnoreCase) ||
                 line.Contains("Writing", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, 50);
        }
        else if (line.Contains("Hash of data verified", StringComparison.OrdinalIgnoreCase) ||
                 line.Contains("Hard resetting", StringComparison.OrdinalIgnoreCase))
        {
            ProgressPct = Math.Max(ProgressPct, 90);
        }
    }

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
        var bundled = Path.Combine(appBase, "emwaver-esp-helper.exe");
        if (File.Exists(bundled))
        {
            return bundled;
        }

        var repo = DebugRepoRoot();
        if (repo != null)
        {
            var repoHelper = Path.Combine(repo, "tools", "emwaver-esp-helper", "dist", "emwaver-esp-helper.exe");
            if (File.Exists(repoHelper))
            {
                return repoHelper;
            }
        }

        throw new FileNotFoundException("Missing bundled ESP helper (emwaver-esp-helper.exe).");
    }

    private (string Bootloader, string PartitionTable, string OtaData, string App) EspFirmwarePaths()
    {
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
                var repoPath = Path.Combine(repo, "esp", "build", name switch
                {
                    "emwaver-esp32s3-app" => "emwaveresp.bin",
                    "emwaver-esp32s3-bootloader" => Path.Combine("bootloader", "bootloader.bin"),
                    "emwaver-esp32s3-partition-table" => Path.Combine("partition_table", "partition-table.bin"),
                    "emwaver-esp32s3-ota-data" => "ota_data_initial.bin",
                    _ => ""
                });
                if (!string.IsNullOrWhiteSpace(repoPath) && File.Exists(repoPath))
                {
                    return repoPath;
                }
            }

            throw new FileNotFoundException($"Missing bundled ESP firmware asset ({name}.bin).");
        }

        return (
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

    private static async Task<bool> IsDfuPresentAsync()
    {
        var selector = UsbDevice.GetDeviceSelector(Dfu.USB_VENDOR_ID, Dfu.USB_PRODUCT_ID);
        var devices = await DeviceInformation.FindAllAsync(selector);
        return devices.Count > 0;
    }

    private static byte[] BuildIdentityPage(byte[] deviceId16, byte[] proof64)
    {
        if (deviceId16.Length != DeviceIdLen) throw new ArgumentException($"DeviceID must be {DeviceIdLen} bytes");
        if (proof64.Length != ProofLen) throw new ArgumentException($"Proof must be {ProofLen} bytes");

        var page = Enumerable.Repeat((byte)0xFF, IdentityPageSize).ToArray();
        page[0] = (byte)'E';
        page[1] = (byte)'M';
        page[2] = (byte)'I';
        page[3] = (byte)'D';
        page[4] = 1;
        page[5] = DeviceIdLen;
        page[6] = ProofLen;
        Buffer.BlockCopy(deviceId16, 0, page, 16, DeviceIdLen);
        Buffer.BlockCopy(proof64, 0, page, 16 + DeviceIdLen, ProofLen);
        return page;
    }

    private static WindowsDeviceManager.DeviceIdentity DecodeIdentity(string deviceIdB64, string proofB64)
    {
        var deviceId = Convert.FromBase64String(deviceIdB64);
        var proof = Convert.FromBase64String(proofB64);
        if (deviceId.Length != DeviceIdLen)
        {
            throw new InvalidOperationException("Backend returned an invalid DeviceID.");
        }
        if (proof.Length != ProofLen)
        {
            throw new InvalidOperationException("Backend returned an invalid Proof.");
        }
        return new WindowsDeviceManager.DeviceIdentity(deviceId, proof);
    }

    private static byte[] GetRootPublicKeyOrThrow()
    {
        var pk = EmwaverRootKey.GetPublicKeyRaw();
        if (pk == null || pk.Length != 32)
        {
            throw new InvalidOperationException("Missing Root public key (EMWAVER_ROOT_PUBLIC_KEY_B64).");
        }
        return pk;
    }

    private static bool VerifyEd25519(byte[] pkRaw32, byte[] message, byte[] signature64)
    {
        try
        {
            var pk = new Ed25519PublicKeyParameters(pkRaw32, 0);
            var verifier = new Ed25519Signer();
            verifier.Init(false, pk);
            verifier.BlockUpdate(message, 0, message.Length);
            return verifier.VerifySignature(signature64);
        }
        catch
        {
            return false;
        }
    }

    private string EffectiveBoardType(WindowsDeviceManager device)
    {
        if (IsEspBoardType(PresentedBoardType)) return "esp32s3";
        if (EspBootloaderConnected || !string.IsNullOrWhiteSpace(EspBootloaderPort)) return "esp32s3";
        return device.ConnectedBoardType ?? device.LastDetectedBoardType ?? "stm32f042";
    }

    private static bool IsEspBoardType(string? boardType)
    {
        return string.Equals(boardType, "esp32s3", StringComparison.OrdinalIgnoreCase);
    }

    private static string Normalize(string? value)
    {
        return (value ?? string.Empty).Trim().ToUpperInvariant();
    }

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
        if (ui == null || ui.HasThreadAccess)
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
