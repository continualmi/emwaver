/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.emwaver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.app.PendingIntent;
import android.content.res.AssetManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;
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

    private TextView titleText;
    private TextView subtitleText;
    private View stmPanel;
    private View stmPromptCard;
    private TextView stmPromptTitle;
    private TextView stmPromptBody;
    private View espPanel;
    private View espTargetContainer;
    private TextView espTargetText;
    private TextView espBootloaderText;
    private Button espRefreshButton;

    private TextView errorText;
    private View progressContainer;
    private TextView progressMessage;
    private TextView progressPct;
    private ProgressBar progressBar;

    private TextView doneText;
    private Button updateButton;
    private Button notNowButton;
    private Button tryAgainButton;
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
        return usbService != null && isEspBoardType(usbService.getConnectedBoardType());
    }

    public static boolean isEspBoardType(@Nullable String boardType) {
        String normalized = normalizeBoardType(boardType);
        return Objects.equals("esp32", normalized)
                || Objects.equals("esp32s2", normalized)
                || Objects.equals("esp32s3", normalized);
    }

    public static String espUpdateUnavailableMessage() {
        return "Reconnect the ESP board in Run Mode once so EMWaver can detect the ESP family, then use serial bootloader mode to flash bundled firmware locally from Android.";
    }

    private static String normalizeBoardType(@Nullable String boardType) {
        return EspSerialFirmwareUpdater.normalizeBoardType(boardType);
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle savedInstanceState
    ) {
        View root = inflater.inflate(R.layout.dialog_update_device, container, false);

        titleText = root.findViewById(R.id.update_title);
        subtitleText = root.findViewById(R.id.update_subtitle);
        stmPanel = root.findViewById(R.id.stm_panel);
        stmPromptCard = root.findViewById(R.id.stm_prompt_card);
        stmPromptTitle = root.findViewById(R.id.stm_prompt_title);
        stmPromptBody = root.findViewById(R.id.stm_prompt_body);
        espPanel = root.findViewById(R.id.esp_panel);
        espTargetContainer = root.findViewById(R.id.esp_target_container);
        espTargetText = root.findViewById(R.id.esp_target_text);
        espBootloaderText = root.findViewById(R.id.esp_bootloader_text);
        espRefreshButton = root.findViewById(R.id.esp_refresh_button);
        errorText = root.findViewById(R.id.update_error_text);
        progressContainer = root.findViewById(R.id.progress_container);
        progressMessage = root.findViewById(R.id.progress_message);
        progressPct = root.findViewById(R.id.progress_pct);
        progressBar = root.findViewById(R.id.progress_bar);
        doneText = root.findViewById(R.id.update_done_text);
        updateButton = root.findViewById(R.id.update_device_button);
        notNowButton = root.findViewById(R.id.not_now_button);
        tryAgainButton = root.findViewById(R.id.try_again_button);
        closeButton = root.findViewById(R.id.close_button);

        closeButton.setOnClickListener(v -> {
            if (!isFlashing) {
                dismiss();
            }
        });

        updateButton.setOnClickListener(v -> handlePrimaryAction());
        if (notNowButton != null) {
            notNowButton.setOnClickListener(v -> {
                if (!isFlashing) {
                    dismiss();
                }
            });
        }
        if (tryAgainButton != null) {
            tryAgainButton.setOnClickListener(v -> {
                clearError();
                handlePrimaryAction();
            });
        }
        if (espRefreshButton != null) {
            espRefreshButton.setOnClickListener(v -> updateDfuStateUi());
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
        if (getDialog() != null && getDialog().getWindow() != null) {
            int width = Math.min(dp(540), getResources().getDisplayMetrics().widthPixels - dp(32));
            getDialog().getWindow().setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        }
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
        UsbDevice espSerialDevice = findEspSerialDevice();
        boolean espSerialDevicePresent = espSerialDevice != null;
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
        boolean espRunModeConnected = isEspBoardConnected();
        boolean espWorkflow = espRunModeConnected || espSerialDevicePresent;
        boolean hasError = hasError();
        String espBoardType = detectedEspBoardType(espSerialDevice);

        if (espWorkflow) {
            showEspState(espSerialDevicePresent, espRunModeConnected, espBoardType, hasError);
        } else {
            showStmState(runConnected, dfuReady, hasError);
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
            showError(espUpdateUnavailableMessage());
            return;
        }

        // Enter DFU via opcode, then disconnect. User must unplug/replug for DFU enumeration.
        emitProgress("Switching device to Update Mode...");
        try {
            svc.requestEnterUpdateMode();
        } catch (Throwable ignored) {
        }
        mgr.disconnect();
        updateDfuStateUi();
    }

    private void handlePrimaryAction() {
        if (isFlashing) {
            return;
        }
        if (isEspBoardConnected() || findEspSerialDevice() != null) {
            startUpdate();
            return;
        }
        boolean dfuReady = usbService != null && usbService.isFlashDeviceConnected() && usbService.hasUsbPermission();
        if (dfuReady) {
            startUpdate();
            return;
        }
        enterUpdateMode();
    }

    private void startUpdate() {
        clearError();
        setDone(false);
        lastPct = 0;
        setProgress(0, "", false);

        if (isEspBoardConnected() || findEspSerialDevice() != null) {
            startEspSerialUpdate();
            return;
        }
        if (usbService == null || dfu == null) {
            showError("USB Service not available");
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

    @Nullable
    private UsbDevice findEspSerialDevice() {
        if (!isAdded()) {
            return null;
        }
        UsbManager manager = (UsbManager) requireContext().getSystemService(Context.USB_SERVICE);
        return EspSerialFirmwareUpdater.findCandidateDevice(manager);
    }

    private void startEspSerialUpdate() {
        UsbManager manager = (UsbManager) requireContext().getSystemService(Context.USB_SERVICE);
        if (manager == null) {
            showError("USB manager not available.");
            return;
        }
        UsbDevice device = EspSerialFirmwareUpdater.findCandidateDevice(manager);
        if (device == null) {
            showError(espUpdateUnavailableMessage());
            return;
        }
        if (!manager.hasPermission(device)) {
            PendingIntent usbPermissionIntent = PendingIntent.getBroadcast(
                    requireContext(),
                    0,
                    new Intent(USBService.ACTION_CONNECT_USB_BOOTLOADER).putExtra(UsbManager.EXTRA_DEVICE, device),
                    PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0)
            );
            manager.requestPermission(device, usbPermissionIntent);
            showError("USB permission requested for ESP serial bootloader. Tap Flash firmware again after permission is granted.");
            return;
        }

        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) {
            showError("Opening ESP serial bootloader failed.");
            return;
        }

        isFlashing = true;
        updateDfuStateUi();
        String boardType = detectedEspBoardType(device);
        if (!isEspBoardType(boardType)) {
            showError(espUpdateUnavailableMessage());
            isFlashing = false;
            updateDfuStateUi();
            return;
        }

        new Thread(() -> {
            try {
                EspSerialFirmwareUpdater.flashBundledImage(
                        requireContext().getApplicationContext(),
                        manager,
                        device,
                        connection,
                        boardType,
                        this::emitProgress
                );
                handler.post(() -> {
                    updateDone = true;
                    setDone(true);
                });
            } catch (Exception e) {
                handler.post(() -> showError(String.valueOf(e.getMessage() != null ? e.getMessage() : e)));
            } finally {
                try {
                    connection.close();
                } catch (Throwable ignored) {
                }
                isFlashing = false;
                handler.post(this::updateDfuStateUi);
            }
        }, "EMW-ESP-FLASH").start();
    }

    @Nullable
    private String detectedEspBoardType(@Nullable UsbDevice serialDevice) {
        String runModeBoardType = usbService != null ? normalizeBoardType(usbService.getConnectedBoardType()) : "";
        if (isEspBoardType(runModeBoardType)) {
            return runModeBoardType;
        }
        String lastKnownBoardType = usbService != null ? normalizeBoardType(usbService.getLastKnownBoardType()) : "";
        if (isEspBoardType(lastKnownBoardType)) {
            return lastKnownBoardType;
        }
        return EspSerialFirmwareUpdater.inferBoardType(serialDevice);
    }

    private void showStmState(boolean runConnected, boolean dfuReady, boolean hasError) {
        setVisible(stmPanel, true);
        setVisible(espPanel, false);
        setVisible(stmPromptCard, !hasError && !isFlashing && !updateDone);

        if (titleText != null) {
            titleText.setText(updateDone ? "Reconnect device" : dfuReady ? "Flash device" : "Install firmware");
        }
        if (subtitleText != null) {
            subtitleText.setText(updateDone
                    ? "Firmware installed. Disconnect and reconnect the device to continue."
                    : dfuReady
                    ? "The device is in Update Mode and ready to flash."
                    : runConnected
                    ? "This firmware can be updated from the local app."
                    : "Follow the prompts to keep the device on managed EMWaver firmware.");
        }
        if (stmPromptTitle != null && stmPromptBody != null) {
            if (dfuReady) {
                stmPromptTitle.setText("Do you want to flash the device?");
                stmPromptBody.setText("The board is connected in Update Mode. Flashing will install the managed EMWaver firmware bundled with this app.");
            } else if (runConnected) {
                stmPromptTitle.setText("Do you want to put this device into Update Mode?");
                stmPromptBody.setText("EMWaver can talk to the board. The app can switch it into Update Mode and prepare the local flash flow for you.");
            } else {
                stmPromptTitle.setText("Waiting for a firmware action");
                stmPromptBody.setText("Connect a supported board in Run Mode or Update Mode and EMWaver will guide the next step.");
            }
        }

        setVisible(notNowButton, !isFlashing && !updateDone && !hasError && (runConnected || dfuReady));
        setVisible(tryAgainButton, !isFlashing && !updateDone && hasError && (runConnected || dfuReady));
        setPrimaryVisible(!isFlashing && !updateDone && !hasError && (runConnected || dfuReady));
        if (updateButton != null) {
            updateButton.setText(dfuReady ? "Flash" : "Enter Update Mode");
            updateButton.setEnabled(runConnected || dfuReady);
        }
        if (closeButton != null) {
            closeButton.setText(updateDone ? "Done" : "Close");
            closeButton.setEnabled(!isFlashing);
        }
    }

    private void showEspState(boolean espSerialDevicePresent, boolean espRunModeConnected, @Nullable String espBoardType, boolean hasError) {
        setVisible(stmPanel, false);
        setVisible(espPanel, true);

        if (titleText != null) {
            titleText.setText("Flash ESP32");
        }
        if (subtitleText != null) {
            subtitleText.setText("Use the board's flash-capable serial USB connection.");
        }
        if (espTargetText != null) {
            String targetName = displayBoardName(espBoardType);
            espTargetText.setText(targetName != null ? targetName + " detected" : "Target not detected yet");
            espTargetText.setTextColor(getResources().getColor(
                    targetName != null ? R.color.textPrimary : R.color.destructiveAction));
        }
        if (espBootloaderText != null) {
            espBootloaderText.setText(espSerialDevicePresent
                    ? "Detected."
                    : "Not detected yet. Put the board in bootloader mode, then tap Refresh.");
            espBootloaderText.setTextColor(getResources().getColor(
                    espSerialDevicePresent ? R.color.colorPrimary : R.color.textSecondary));
        }

        setVisible(espTargetContainer, !updateDone);
        if (espRefreshButton != null) {
            espRefreshButton.setEnabled(!isFlashing);
        }
        setVisible(notNowButton, false);
        setVisible(tryAgainButton, !isFlashing && !updateDone && hasError);
        setPrimaryVisible(!isFlashing && !updateDone && !hasError);
        if (updateButton != null) {
            updateButton.setText("Flash firmware");
            updateButton.setEnabled((espSerialDevicePresent || espRunModeConnected) && isEspBoardType(espBoardType));
        }
        if (closeButton != null) {
            closeButton.setText(updateDone ? "Done" : "Close");
            closeButton.setEnabled(!isFlashing);
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
        updateDfuStateUi();
    }

    private void clearError() {
        if (errorText != null) {
            errorText.setText("");
            errorText.setVisibility(View.GONE);
        }
    }

    private boolean hasError() {
        return errorText != null
                && errorText.getVisibility() == View.VISIBLE
                && errorText.getText() != null
                && errorText.getText().toString().trim().length() > 0;
    }

    private void setPrimaryVisible(boolean visible) {
        setVisible(updateButton, visible);
    }

    private static void setVisible(@Nullable View view, boolean visible) {
        if (view != null) {
            view.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Nullable
    private String displayBoardName(@Nullable String boardType) {
        switch (normalizeBoardType(boardType)) {
            case "esp32s3":
                return "ESP32-S3";
            case "esp32s2":
                return "ESP32-S2";
            case "esp32":
                return "ESP32";
            default:
                return null;
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
                if (device.getVendorId() == Dfu.USB_VENDOR_ID && device.getProductId() == Dfu.USB_PRODUCT_ID) {
                    UsbDeviceConnection connection = ((UsbManager) context.getSystemService(Context.USB_SERVICE)).openDevice(device);
                    usbService.setUsbDeviceConnection(connection);
                }
                handler.post(UpdateDeviceDialogFragment.this::updateDfuStateUi);
            }
        }
    };
}
