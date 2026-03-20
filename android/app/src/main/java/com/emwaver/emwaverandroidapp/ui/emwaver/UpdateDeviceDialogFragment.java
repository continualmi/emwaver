/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.emwaver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.DialogFragment;

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.USBService;
import com.emwaver.emwaverandroidapp.ui.flash.Dfu;


import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class UpdateDeviceDialogFragment extends DialogFragment {
    private static final String BUNDLED_FIRMWARE_ASSET_PATH = "firmware/emwaver.bin";

    private TextView dfuConnectedBanner;
    private View instructionsCard;

    private TextView dfuInstructions;
    private Button enterUpdateModeButton;

    private TextView errorText;
    private View progressContainer;
    private TextView progressMessage;
    private TextView progressPct;
    private ProgressBar progressBar;

    private TextView doneText;
    private Button updateButton;
    private Button closeButton;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;

    private volatile boolean isFlashing = false;
    private volatile boolean updateDone = false;

    private USBService usbService;
    private Dfu dfu;

    private final Pattern pctPattern = Pattern.compile("\\((\\d+)%\\)\\s*$");
    private int lastPct = 0;

    private boolean isEspBoardConnected() {
        return usbService != null && Objects.equals("esp32s3", normalizeBoardType(usbService.getConnectedBoardType()));
    }

    private String normalizeBoardType(@Nullable String boardType) {
        return boardType == null ? "" : boardType.trim().toLowerCase(Locale.US);
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle savedInstanceState
    ) {
        View root = inflater.inflate(R.layout.dialog_update_device, container, false);

        instructionsCard = root.findViewById(R.id.instructions_card);
        dfuInstructions = root.findViewById(R.id.dfu_instructions);
        enterUpdateModeButton = root.findViewById(R.id.enter_update_mode_button);
        dfuConnectedBanner = root.findViewById(R.id.dfu_connected_banner);
        errorText = root.findViewById(R.id.update_error_text);
        progressContainer = root.findViewById(R.id.progress_container);
        progressMessage = root.findViewById(R.id.progress_message);
        progressPct = root.findViewById(R.id.progress_pct);
        progressBar = root.findViewById(R.id.progress_bar);
        doneText = root.findViewById(R.id.update_done_text);
        updateButton = root.findViewById(R.id.update_device_button);
        closeButton = root.findViewById(R.id.close_button);

        closeButton.setOnClickListener(v -> {
            if (!isFlashing) {
                dismiss();
            }
        });

        updateButton.setOnClickListener(v -> startUpdate());

        if (enterUpdateModeButton != null) {
            enterUpdateModeButton.setOnClickListener(v -> enterUpdateMode());
        }

        clearError();
        lastPct = 0;
        setProgress(0, "", false);
        setDone(false);

        return root;
    }

    @Override
    public void onStart() {
        super.onStart();
        DeviceConnectionManager mgr = DeviceConnectionManager.getInstance(requireContext());
        usbService = mgr.getUsbService();
        if (usbService != null) {
            dfu = new Dfu(usbService);
        }

        requireContext().registerReceiver(connectReceiver, new IntentFilter(USBService.ACTION_CONNECT_USB_BOOTLOADER));
        startPolling();
    }

    @Override
    public void onStop() {
        super.onStop();
        stopPolling();
        try {
            requireContext().unregisterReceiver(connectReceiver);
        } catch (IllegalArgumentException ignored) {
        }
    }

    private void startPolling() {
        stopPolling();
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                updateDfuStateUi();
                handler.postDelayed(this, 1000);
            }
        };
        handler.post(pollRunnable);
    }

    private void stopPolling() {
        if (pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
            pollRunnable = null;
        }
    }

    private void updateDfuStateUi() {
        if (!isAdded()) {
            return;
        }
        if (usbService == null) {
            DeviceConnectionManager mgr = DeviceConnectionManager.getInstance(requireContext());
            usbService = mgr.getUsbService();
            if (usbService != null && dfu == null) {
                dfu = new Dfu(usbService);
            }
        }

        boolean dfuDevicePresent = usbService != null && usbService.isFlashDeviceConnected();
        boolean hasPermission = usbService != null && usbService.hasUsbPermission();
        boolean hasConnection = usbService != null && usbService.getUsbDeviceConnection() != null;

        DeviceConnectionManager mgr = DeviceConnectionManager.getInstance(requireContext());
        boolean runConnected = mgr.isConnected();
        if (dfuDevicePresent && !hasPermission && !isFlashing) {
            // Best-effort: request permission automatically.
            usbService.requestUsbPermission();
        }
        if (dfuDevicePresent && hasPermission && !hasConnection && !isFlashing) {
            usbService.connectUSBFlash();
        }

        boolean dfuReady = dfuDevicePresent && hasPermission;
        boolean espBoardConnected = isEspBoardConnected();
        boolean canEnterUpdate = runConnected && !dfuDevicePresent && !espBoardConnected;

        if (espBoardConnected && !isFlashing && !updateDone) {
            showError("ESP32-S3 flashing is not wired on Android yet. The runtime USB path now connects, but firmware updates still need the ESP-native flow on macOS.");
        }

        if (instructionsCard != null) {
            instructionsCard.setVisibility((!dfuReady && !updateDone) ? View.VISIBLE : View.GONE);
        }
        if (dfuConnectedBanner != null) {
            dfuConnectedBanner.setVisibility((dfuReady && !updateDone) ? View.VISIBLE : View.GONE);
        }
        if (dfuInstructions != null) {
            dfuInstructions.setVisibility((!dfuReady && !updateDone) ? View.VISIBLE : View.GONE);
        }

        if (enterUpdateModeButton != null) {
            enterUpdateModeButton.setEnabled(canEnterUpdate && !isFlashing);
        }

        if (updateButton != null) {
            updateButton.setEnabled(dfuReady && !espBoardConnected && !isFlashing);
        }
        if (closeButton != null) {
            closeButton.setEnabled(!isFlashing);
        }
    }

    private void enterUpdateMode() {
        clearError();
        setDone(false);

        DeviceConnectionManager mgr = DeviceConnectionManager.getInstance(requireContext());
        USBService svc = mgr.getUsbService();
        boolean connected = mgr.isConnected();
        if (!connected) {
            showError("Connect a device first.");
            return;
        }
        if (isEspBoardConnected()) {
            showError("ESP32-S3 does not support the STM32 DFU flow on Android. Use the ESP flashing path on macOS for now.");
            return;
        }

        // Enter DFU via opcode, then disconnect. User must unplug/replug for DFU enumeration.
        emitProgress("Switching device to Update Mode...");
        try {
            svc.requestEnterUpdateMode();
        } catch (Throwable ignored) {
        }
        mgr.disconnect();

        if (dfuInstructions != null) {
            dfuInstructions.setVisibility(View.VISIBLE);
        }
        updateDfuStateUi();
    }

    private void startUpdate() {
        clearError();
        setDone(false);
        lastPct = 0;
        setProgress(0, "", false);

        if (usbService == null || dfu == null) {
            showError("USB Service not available");
            return;
        }
        if (isEspBoardConnected()) {
            showError("ESP32-S3 flashing is not available on Android yet. Use the ESP flashing path on macOS for now.");
            return;
        }
        if (!usbService.isFlashDeviceConnected() || !usbService.hasUsbPermission()) {
            showError(
                    "Connect the device in Update Mode first (unplug, flip the Update switch to Update, plug in, then wait for EMWaver to detect it)."
            );
            return;
        }
        if (usbService.getUsbDeviceConnection() == null) {
            usbService.connectUSBFlash();
        }
        if (usbService.getUsbDeviceConnection() == null) {
            showError("Opening device in Update Mode... failed");
            return;
        }

        isFlashing = true;
        updateDfuStateUi();

        new Thread(() -> {
            try {
                emitProgress("Using bundled firmware");
                emitProgress("Opening device in Update Mode...");

                byte[] firmware = readBundledFirmware();
                if (firmware == null || firmware.length == 0) {
                    throw new Exception("Bundled firmware missing");
                }

                flashFirmwareWithDesktopProgress(firmware, 0x08000000);

                handler.post(() -> {
                    updateDone = true;
                    setDone(true);
                });
            } catch (Exception e) {
                handler.post(() -> showError(String.valueOf(e)));
            } finally {
                isFlashing = false;
                handler.post(this::updateDfuStateUi);
            }
        }, "EMW-DFU").start();
    }

    private byte[] readBundledFirmware() throws IOException {
        AssetManager assets = requireContext().getAssets();
        try (InputStream in = assets.open(BUNDLED_FIRMWARE_ASSET_PATH);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private void readBlockOrFail(byte[] buffer, int block, int numBytes) throws Exception {
        if (usbService == null || usbService.getUsbDeviceConnection() == null) {
            throw new Exception("USB connection not available");
        }
        if (buffer == null || buffer.length < numBytes) {
            throw new Exception("Read buffer too small");
        }

        String lastErr = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
                try {
                    usbService.getUsbDeviceConnection().controlTransfer(
                            Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_ABORT, 0, 0, null, 0, 500);
                } catch (Throwable ignored) {
                }
                try {
                    dfu.clearStatus();
                } catch (Throwable ignored) {
                }
                try {
                    dfu.waitUploadIdle();
                } catch (Throwable ignored) {
                }
                Thread.sleep(20);
            }

            int n = usbService.getUsbDeviceConnection().controlTransfer(
                    Dfu.DFU_REQUEST_TYPE_IN, Dfu.DFU_UPLOAD, block, 0, buffer, numBytes, 1500);
            if (n == numBytes) {
                return;
            }
            if (n < 0) {
                lastErr = "DFU_UPLOAD failed";
            } else {
                lastErr = "DFU_UPLOAD returned " + n + " bytes (expected " + numBytes + ")";
            }
        }

        throw new Exception(lastErr != null ? lastErr : "DFU_UPLOAD failed");
    }

    private void flashFirmwareWithDesktopProgress(byte[] firmware, int address) throws Exception {
        if (usbService == null || dfu == null) {
            throw new Exception("USB service or DFU not available");
        }

        int totalBlocks = (firmware.length + Dfu.BLOCK_SIZE - 1) / Dfu.BLOCK_SIZE;
        int totalSteps = Math.max(1, totalBlocks * 2 + 2);

        int step = 0;
        emitProgress(formatProgress(step, totalSteps, "Starting mass erase..."));
        massErase();

        step += 1;
        emitProgress(formatProgress(step, totalSteps, "Mass erase complete. Setting address pointer..."));
        setAddressPointer(address);

        step += 1;
        emitProgress(formatProgress(step, totalSteps, "Address pointer set. Starting flash write..."));

        int blockNum = 2;
        byte[] readBuffer = new byte[Dfu.BLOCK_SIZE];
        for (int blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
            int chunkStart = blockIndex * Dfu.BLOCK_SIZE;
            int chunkLen = Math.min(Dfu.BLOCK_SIZE, firmware.length - chunkStart);
            byte[] chunk = new byte[chunkLen];
            System.arraycopy(firmware, chunkStart, chunk, 0, chunkLen);

            int oneBased = blockIndex + 1;
            emitProgress(formatProgress(step, totalSteps,
                    String.format(Locale.US, "Writing block %d (%d/%d)...", blockNum, oneBased, totalBlocks)));
            writeBlock(chunk, blockNum, chunkLen);

            step += 1;
            emitProgress(formatProgress(step, totalSteps,
                    String.format(Locale.US, "Verifying block %d (%d/%d)...", blockNum, oneBased, totalBlocks)));
            dfu.waitUploadIdle();
            dfu.readBlock(readBuffer, blockNum, chunkLen);

            for (int i = 0; i < chunkLen; i++) {
                if (readBuffer[i] != chunk[i]) {
                    throw new Exception("Error verifying block " + (blockNum - 2));
                }
            }

            step += 1;
            blockNum += 1;
        }

        emitProgress(formatProgress(totalSteps, totalSteps, "Flash write completed successfully."));
    }

    private static String formatProgress(int step, int totalSteps, String message) {
        int pct = (int) Math.min(100L, (step * 100L) / Math.max(1, totalSteps));
        return message + " (" + pct + "%)";
    }

    private void massErase() throws Exception {
        byte[] massEraseCommand = {0x41};
        byte[] status = new byte[6];

        dfu.waitDownloadIdle();

        int length = usbService.getUsbDeviceConnection().controlTransfer(
                Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, 0, 0, massEraseCommand, 1, 50);
        if (length < 0) {
            throw new Exception("error: mass_erase() control transfer failed");
        }

        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("error while mass erasing (not dfuDNBUSY)");
        }

        int bwPollTimeout = ((status[3] & 0xFF) << 16) | ((status[2] & 0xFF) << 8) | (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout);

        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("mass erase failed");
        }
    }

    private void setAddressPointer(int address) throws Exception {
        byte[] buffer = new byte[5];
        buffer[0] = 0x21;
        buffer[1] = (byte) (address & 0xFF);
        buffer[2] = (byte) ((address >> 8) & 0xFF);
        buffer[3] = (byte) ((address >> 16) & 0xFF);
        buffer[4] = (byte) ((address >> 24) & 0xFF);

        dfu.waitDownloadIdle();

        int length = usbService.getUsbDeviceConnection().controlTransfer(
                Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, 0, 0, buffer, buffer.length, 50);
        if (length < 0) {
            throw new Exception("error: set_address_pointer() control transfer failed");
        }

        byte[] status = new byte[6];
        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("error while setting pointer (not dfuDNBUSY)");
        }

        int bwPollTimeout = ((status[3] & 0xFF) << 16) | ((status[2] & 0xFF) << 8) | (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout);

        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("setting pointer failed");
        }
    }

    private void writeBlock(byte[] buffer, int block, int numBytes) throws Exception {
        dfu.waitDownloadIdle();

        int length = usbService.getUsbDeviceConnection().controlTransfer(
                Dfu.DFU_REQUEST_TYPE_OUT, Dfu.DFU_DNLOAD, block, 0, buffer, numBytes, 500);
        if (length < 0) {
            throw new Exception("error: write_block() control transfer failed");
        }

        byte[] status = new byte[6];
        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_DOWNLOAD_BUSY || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("error while writing (not dfuDNBUSY)");
        }

        int bwPollTimeout = ((status[3] & 0xFF) << 16) | ((status[2] & 0xFF) << 8) | (status[1] & 0xFF);
        Thread.sleep(bwPollTimeout);

        dfu.getStatus(status);
        if (!(status[4] == Dfu.STATE_DFU_IDLE || status[4] == Dfu.STATE_DFU_DOWNLOAD_IDLE)) {
            throw new Exception("block write failed");
        }
    }

    private void emitProgress(String message) {
        handler.post(() -> {
            if (!isAdded()) return;
            String raw = message != null ? message.trim() : "";
            int pct = extractPct(raw);
            String stripped = stripPctSuffix(raw);
            setProgress(pct, stripped, true);
        });
    }

    private String stripPctSuffix(String message) {
        if (message == null) return "";
        Matcher m = pctPattern.matcher(message.trim());
        if (!m.find()) {
            return message;
        }
        return message.substring(0, m.start()).trim();
    }

    private int extractPct(String message) {
        if (message == null) return 0;
        Matcher m = pctPattern.matcher(message.trim());
        if (!m.find()) return lastPct;
        try {
            int pct = Integer.parseInt(m.group(1));
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            lastPct = pct;
            return lastPct;
        } catch (NumberFormatException e) {
            return lastPct;
        }
    }

    private void setProgress(int pct, String message, boolean visible) {
        if (progressContainer != null) {
            progressContainer.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
        if (progressMessage != null) {
            progressMessage.setText(message != null ? message : "");
        }
        if (progressPct != null) {
            progressPct.setText(String.format(Locale.US, "%d%%", pct));
        }
        if (progressBar != null) {
            progressBar.setProgress(pct);
        }
    }

    private void setDone(boolean done) {
        updateDone = done;
        if (doneText != null) {
            doneText.setVisibility(done ? View.VISIBLE : View.GONE);
        }
        if (updateButton != null) {
            updateButton.setVisibility(done ? View.GONE : View.VISIBLE);
        }
    }

    private void showError(String message) {
        if (errorText != null) {
            errorText.setText(message != null ? message : "");
            errorText.setVisibility(View.VISIBLE);
        }
    }

    private void clearError() {
        if (errorText != null) {
            errorText.setText("");
            errorText.setVisibility(View.GONE);
        }
    }

    private final BroadcastReceiver connectReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!USBService.ACTION_CONNECT_USB_BOOTLOADER.equals(intent.getAction())) {
                return;
            }
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
            if (usbService == null) {
                DeviceConnectionManager mgr = DeviceConnectionManager.getInstance(requireContext());
                usbService = mgr.getUsbService();
            }
            if (!granted) {
                handler.post(() -> showError("USB permission denied or no response. Please try again."));
                return;
            }
            if (device != null && usbService != null) {
                UsbDeviceConnection connection = ((UsbManager) context.getSystemService(Context.USB_SERVICE)).openDevice(device);
                usbService.setUsbDeviceConnection(connection);
                handler.post(UpdateDeviceDialogFragment.this::updateDfuStateUi);
            }
        }
    };
}
