using Microsoft.UI.Dispatching;
using System;
using System.ComponentModel;
using System.Diagnostics;
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
    private Timer? _dfuPollTimer;

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

        // Use a plain Timer (avoids WindowsAppSDK DispatcherQueueTimer metadata differences across toolchains).
        _dfuPollTimer = new Timer(_ =>
        {
            _ = RefreshDfuPresenceAsync();
        }, null, dueTime: 0, period: 900);
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

        bool present;
        try
        {
            present = await IsDfuPresentAsync();
        }
        catch
        {
            present = false;
        }

        RunOnUi(() => DfuConnected = present);
    }

    private WindowsDeviceManager.DeviceIdentity? _preservedIdentity;

    public async Task StartUpdateAsync(WindowsDeviceManager device)
    {
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "Preparing update...";

        if (IsFlashing) return;

        _preservedIdentity = null;

        // Gate: only secured devices can be updated.
        // For run-mode devices we can use the already-verified secure connection state.
        if (device.IsConnected && !device.IsSecureConnected)
        {
            UpdateError = "Firmware update blocked: device is not secured.";
            ProgressMessage = "";
            return;
        }

        // Prefer preserving identity from Run mode (EMW opcode), because ROM DFU mass erase wipes it.
        if (device.IsConnected && device.IsSecureConnected)
        {
            _preservedIdentity = await device.ReadDeviceIdentityAsync(timeoutMs: 900);
            if (_preservedIdentity == null)
            {
                UpdateError = "Failed to read device identity in Run mode. Reconnect and retry.";
                ProgressMessage = "";
                return;
            }
        }

        // If DFU is already present, gate on DFU identity (if needed), then flash.
        if (DfuConnected)
        {
            try
            {
                if (_preservedIdentity == null)
                {
                    await GateOnDfuIdentityOrFailAsync();
                }
                await RunFlashAsync();
            }
            catch (Exception ex)
            {
                // Keep full details; COMException messages are often empty.
                UpdateError = ex.ToString();
                ProgressMessage = "";
            }
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

        try
        {
            await GateOnDfuIdentityOrFailAsync();
            await RunFlashAsync();
        }
        catch (Exception ex)
        {
            UpdateError = ex.Message;
            ProgressMessage = "";
        }
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

    private const uint IdentityPageAddr = 0x0800_7800;
    private const int IdentityPageSize = 1024;
    private const int DeviceIdLen = 16;
    private const int ProofLen = 64;

    private static byte[] BuildIdentityPage(byte[] deviceId16, byte[] proof64)
    {
        if (deviceId16.Length != DeviceIdLen) throw new ArgumentException($"DeviceID must be {DeviceIdLen} bytes");
        if (proof64.Length != ProofLen) throw new ArgumentException($"Proof must be {ProofLen} bytes");

        var page = new byte[IdentityPageSize];
        for (int i = 0; i < page.Length; i++) page[i] = 0xFF;

        page[0] = (byte)'E';
        page[1] = (byte)'M';
        page[2] = (byte)'I';
        page[3] = (byte)'D';
        page[4] = 1;
        page[5] = (byte)DeviceIdLen;
        page[6] = (byte)ProofLen;

        var off = 16;
        System.Buffer.BlockCopy(deviceId16, 0, page, off, DeviceIdLen);
        off += DeviceIdLen;
        System.Buffer.BlockCopy(proof64, 0, page, off, ProofLen);

        return page;
    }

    private static bool VerifyEd25519(byte[] pkRaw32, byte[] message, byte[] signature64)
    {
        try
        {
            var pk = new Org.BouncyCastle.Crypto.Parameters.Ed25519PublicKeyParameters(pkRaw32, 0);
            var verifier = new Org.BouncyCastle.Crypto.Signers.Ed25519Signer();
            verifier.Init(false, pk);
            verifier.BlockUpdate(message, 0, message.Length);
            return verifier.VerifySignature(signature64);
        }
        catch
        {
            return false;
        }
    }

    private static byte[] GetRootPublicKeyOrThrow()
    {
        var pk = EMWaver.Services.Security.EmwaverRootKey.GetPublicKeyRaw();
        if (pk == null)
        {
            throw new InvalidOperationException("Missing Root public key (EMWAVER_ROOT_PUBLIC_KEY_B64)");
        }
        return pk;
    }

    private async Task GateOnDfuIdentityOrFailAsync()
    {
        var pk = GetRootPublicKeyOrThrow();

        await using var dfu = await Dfu.OpenFirstAsync();
        await dfu.SetAddressPointerAsync(IdentityPageAddr, CancellationToken.None);

        var buf = new byte[IdentityPageSize];
        await dfu.ReadBlockAsync(buf, blockNum: 2, numBytes: IdentityPageSize, CancellationToken.None);

        var hasHeader = buf.Length >= 16
            && buf[0] == (byte)'E' && buf[1] == (byte)'M' && buf[2] == (byte)'I' && buf[3] == (byte)'D'
            && buf[4] == 1
            && buf[5] == DeviceIdLen
            && buf[6] == ProofLen;

        if (!hasHeader)
        {
            throw new InvalidOperationException("Device is not secured (missing identity page)");
        }

        var deviceId = new byte[DeviceIdLen];
        System.Buffer.BlockCopy(buf, 16, deviceId, 0, DeviceIdLen);
        var proof = new byte[ProofLen];
        System.Buffer.BlockCopy(buf, 16 + DeviceIdLen, proof, 0, ProofLen);

        if (!VerifyEd25519(pk, deviceId, proof))
        {
            throw new InvalidOperationException("Device identity proof is invalid");
        }

        _preservedIdentity = new WindowsDeviceManager.DeviceIdentity(deviceId, proof);
    }

    public async Task StartRecoveryAsync(EMWaver.Services.Cloud.CloudAuthManager auth, WindowsDeviceManager device)
    {
        UpdateError = null;
        UpdateDone = false;
        ProgressPct = 0;
        ProgressMessage = "Recovering device identity...";

        if (IsFlashing) return;

        try
        {
            IsFlashing = true;

            // Step 1: sign in and request a fresh DeviceID+Proof.
            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(2));
            var idToken = await auth.EnsureSignedInAsync(cts.Token);
            if (string.IsNullOrWhiteSpace(idToken))
            {
                throw new InvalidOperationException("Sign in to recover device identity.");
            }

            var baseUrl = EMWaver.Services.Cloud.BackendUrl.Resolve().Trim().TrimEnd('/');
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                throw new InvalidOperationException("Missing backend URL (configure backend first)." );
            }

            ProgressMessage = "Minting identity...";

            var url = new Uri(baseUrl + "/provisioning/mint");
            using var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, url);
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", idToken);

            var res = await AppServices.Http.SendAsync(req, cts.Token);
            var body = await res.Content.ReadAsStringAsync(cts.Token);
            if (!res.IsSuccessStatusCode)
            {
                throw new InvalidOperationException($"Mint failed: {body}");
            }

            using var doc = System.Text.Json.JsonDocument.Parse(body);
            var root = doc.RootElement;
            var devB64 = root.GetProperty("device_id_b64").GetString() ?? "";
            var proofB64 = root.GetProperty("proof_b64").GetString() ?? "";
            var dev = Convert.FromBase64String(devB64);
            var proof = Convert.FromBase64String(proofB64);

            if (dev.Length != DeviceIdLen || proof.Length != ProofLen)
            {
                throw new InvalidOperationException("Mint returned malformed identity");
            }

            // Step 2: enter DFU and write identity page.
            ProgressMessage = "Switching device to Update Mode...";

            if (device.IsConnected)
            {
                device.RequestEnterUpdateMode();
                device.Disconnect();
            }

            // Wait for DFU.
            var detected = false;
            var deadline = DateTimeOffset.UtcNow.AddSeconds(8);
            while (DateTimeOffset.UtcNow < deadline)
            {
                detected = await IsDfuPresentAsync();
                if (detected) break;
                await Task.Delay(250, cts.Token);
            }
            if (!detected)
            {
                throw new InvalidOperationException("DFU not detected");
            }

            ProgressMessage = "Writing identity page...";

            var page = BuildIdentityPage(dev, proof);
            await using (var dfu = await Dfu.OpenFirstAsync())
            {
                await dfu.SetAddressPointerAsync(IdentityPageAddr, cts.Token);
                await dfu.WriteBlockAsync(page, blockNum: 2, numBytes: page.Length, cts.Token);
            }

            ProgressMessage = "Identity recovered. Reconnect device and retry update.";
        }
        catch (Exception ex)
        {
            UpdateError = ex.ToString();
            ProgressMessage = "";
        }
        finally
        {
            IsFlashing = false;
        }
    }

    private async Task RunFlashAsync()
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

        void Log(string s)
        {
            Debug.WriteLine($"[DFU] {s}");
        }

        void SetProgress(string msg, double pct)
        {
            RunOnUi(() =>
            {
                ProgressMessage = msg;
                ProgressPct = pct;
            });
            Log($"{msg} ({pct:0.##}%)");
        }

        try
        {
            var fwPath = FirmwarePath();
            var fwBytes = await File.ReadAllBytesAsync(fwPath);

            SetProgress("Starting mass erase...", 0);

            using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            var ct = cts.Token;

            Log("Opening DFU device...");
            await using var dfu = await Dfu.OpenFirstAsync();
            Log("DFU device opened.");

            Log("Mass erase...");
            await dfu.MassEraseAsync(ct);

            SetProgress("Mass erase complete. Setting address pointer...", 2);
            Log("SetAddressPointer 0x08000000...");
            await dfu.SetAddressPointerAsync(0x0800_0000, ct);

            var totalBlocks = (fwBytes.Length + Dfu.BLOCK_SIZE - 1) / Dfu.BLOCK_SIZE;
            var totalSteps = Math.Max(1, totalBlocks * 2 + 2);
            var step = 2;

            SetProgress("Address pointer set. Starting flash write...", (step * 100.0) / totalSteps);

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
                System.Buffer.BlockCopy(fwBytes, chunkStart, chunk, 0, chunkLen);
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

            // Restore identity page after DFU flash (ROM DFU mass erase wipes it).
            if (_preservedIdentity != null)
            {
                SetProgress("Restoring device identity...", 98);
                var page = BuildIdentityPage(_preservedIdentity.DeviceId, _preservedIdentity.Proof);
                await dfu.SetAddressPointerAsync(IdentityPageAddr, ct);
                await dfu.WriteBlockAsync(page, blockNum: 2, numBytes: page.Length, ct);
            }

            SetProgress("Flash write completed successfully.", 100);
            RunOnUi(() => UpdateDone = true);
        }
        catch (Exception ex)
        {
            Log($"FAILED: {ex}");
            RunOnUi(() =>
            {
                // COMException messages are often empty; keep full details for debugging.
                UpdateError = ex.ToString();
            });
        }
        finally
        {
            RunOnUi(() => IsFlashing = false);
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
