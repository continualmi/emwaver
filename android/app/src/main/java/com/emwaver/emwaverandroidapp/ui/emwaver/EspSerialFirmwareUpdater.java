/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.emwaver;

import android.content.Context;
import android.content.res.AssetManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;

import androidx.annotation.Nullable;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

final class EspSerialFirmwareUpdater {
    static final int ESP_BOOTLOADER_OFFSET = 0x1000;
    static final int ESP32S3_BOOTLOADER_OFFSET = 0x0;
    static final int PARTITION_TABLE_OFFSET = 0x8000;
    static final int OTA_DATA_OFFSET = 0x10000;
    static final int APP_OFFSET = 0x20000;
    static final int BLOCK_SIZE = 0x400;

    private static final int BAUD = 115200;
    private static final int SYNC = 0x08;
    private static final int FLASH_BEGIN = 0x02;
    private static final int FLASH_DATA = 0x03;
    private static final int FLASH_END = 0x04;
    private static final int ESP_CHECKSUM_SEED = 0xEF;
    private static final int SLIP_END = 0xC0;
    private static final int SLIP_ESC = 0xDB;
    private static final int SLIP_ESC_END = 0xDC;
    private static final int SLIP_ESC_ESC = 0xDD;

    interface ProgressSink {
        void onProgress(String message);
    }

    static final class FirmwareAssets {
        final String boardType;
        final String chip;
        final String displayName;
        final int bootloaderOffset;
        final String bootloaderAsset;
        final String partitionTableAsset;
        final String otaDataAsset;
        final String appAsset;

        private FirmwareAssets(
                String boardType,
                String chip,
                String displayName,
                int bootloaderOffset,
                String bootloaderAsset,
                String partitionTableAsset,
                String otaDataAsset,
                String appAsset
        ) {
            this.boardType = boardType;
            this.chip = chip;
            this.displayName = displayName;
            this.bootloaderOffset = bootloaderOffset;
            this.bootloaderAsset = bootloaderAsset;
            this.partitionTableAsset = partitionTableAsset;
            this.otaDataAsset = otaDataAsset;
            this.appAsset = appAsset;
        }
    }

    private EspSerialFirmwareUpdater() {}

    @Nullable
    static UsbDevice findCandidateDevice(UsbManager manager) {
        if (manager == null) {
            return null;
        }
        List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(manager);
        for (UsbSerialDriver driver : drivers) {
            UsbDevice device = driver.getDevice();
            if (device != null && isLikelyEspSerialDevice(device)) {
                return device;
            }
        }
        return null;
    }

    static boolean isLikelyEspSerialDevice(@Nullable UsbDevice device) {
        if (device == null) {
            return false;
        }
        int vid = device.getVendorId();
        if (vid == 0x303A || vid == 0x10C4 || vid == 0x1A86 || vid == 0x0403) {
            return true;
        }
        String product = lower(device.getProductName());
        String manufacturer = lower(device.getManufacturerName());
        return product.contains("esp32")
                || product.contains("esp32-s3")
                || product.contains("ch340")
                || product.contains("ch910")
                || product.contains("cp210")
                || manufacturer.contains("espressif")
                || manufacturer.contains("silicon labs")
                || manufacturer.contains("wch")
                || manufacturer.contains("qinheng");
    }

    static void flashBundledImage(
            Context context,
            UsbManager manager,
            UsbDevice device,
            UsbDeviceConnection connection,
            String boardType,
            ProgressSink progress
    ) throws Exception {
        FirmwareAssets assets = assetsForBoardType(boardType);
        byte[] bootloader = readRequiredAsset(context.getAssets(), assets.bootloaderAsset);
        byte[] partitionTable = readRequiredAsset(context.getAssets(), assets.partitionTableAsset);
        byte[] otaData = readRequiredAsset(context.getAssets(), assets.otaDataAsset);
        byte[] app = readRequiredAsset(context.getAssets(), assets.appAsset);

        UsbSerialDriver driver = UsbSerialProber.getDefaultProber().probeDevice(device);
        if (driver == null || driver.getPorts().isEmpty()) {
            throw new IOException("No supported ESP serial port found.");
        }

        UsbSerialPort port = driver.getPorts().get(0);
        try {
            progress.onProgress("Opening ESP serial bootloader... (0%)");
            port.open(connection);
            port.setParameters(BAUD, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            port.setDTR(false);
            port.setRTS(false);
            enterBootloader(port);
            sync(port, progress);
            int totalBytes = bootloader.length + partitionTable.length + otaData.length + app.length;
            int writtenBytes = 0;
            writtenBytes += flashImage(port, bootloader, assets.bootloaderOffset, writtenBytes, totalBytes, "bootloader", progress);
            writtenBytes += flashImage(port, partitionTable, PARTITION_TABLE_OFFSET, writtenBytes, totalBytes, "partition table", progress);
            writtenBytes += flashImage(port, otaData, OTA_DATA_OFFSET, writtenBytes, totalBytes, "OTA data", progress);
            flashImage(port, app, APP_OFFSET, writtenBytes, totalBytes, "app image", progress);
            command(port, FLASH_END, le32(0), 0, 5_000);
            progress.onProgress(assets.displayName + " firmware update complete. Reconnect the device in Run Mode. (100%)");
        } finally {
            try {
                port.close();
            } catch (IOException ignored) {
            }
        }
    }

    static FirmwareAssets assetsForBoardType(String boardType) throws IOException {
        switch (normalizeBoardType(boardType)) {
            case "esp32":
                return new FirmwareAssets(
                        "esp32",
                        "esp32",
                        "ESP32",
                        ESP_BOOTLOADER_OFFSET,
                        "firmware/emwaver-esp32-bootloader.bin",
                        "firmware/emwaver-esp32-partition-table.bin",
                        "firmware/emwaver-esp32-ota-data.bin",
                        "firmware/emwaver-esp32-app.bin"
                );
            case "esp32s2":
                return new FirmwareAssets(
                        "esp32s2",
                        "esp32s2",
                        "ESP32-S2",
                        ESP_BOOTLOADER_OFFSET,
                        "firmware/emwaver-esp32s2-bootloader.bin",
                        "firmware/emwaver-esp32s2-partition-table.bin",
                        "firmware/emwaver-esp32s2-ota-data.bin",
                        "firmware/emwaver-esp32s2-app.bin"
                );
            case "esp32s3":
                return new FirmwareAssets(
                        "esp32s3",
                        "esp32s3",
                        "ESP32-S3",
                        ESP32S3_BOOTLOADER_OFFSET,
                        "firmware/emwaver-esp32s3-bootloader.bin",
                        "firmware/emwaver-esp32s3-partition-table.bin",
                        "firmware/emwaver-esp32s3-ota-data.bin",
                        "firmware/emwaver-esp32s3-app.bin"
                );
            default:
                throw new IOException("Choose an ESP32, ESP32-S2, or ESP32-S3 firmware target.");
        }
    }

    static int checksum(byte[] data) {
        int chk = ESP_CHECKSUM_SEED;
        for (byte b : data) {
            chk ^= (b & 0xFF);
        }
        return chk & 0xFF;
    }

    static byte[] slipEncode(byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(payload.length + 2);
        out.write(SLIP_END);
        for (byte b : payload) {
            int v = b & 0xFF;
            if (v == SLIP_END) {
                out.write(SLIP_ESC);
                out.write(SLIP_ESC_END);
            } else if (v == SLIP_ESC) {
                out.write(SLIP_ESC);
                out.write(SLIP_ESC_ESC);
            } else {
                out.write(v);
            }
        }
        out.write(SLIP_END);
        return out.toByteArray();
    }

    static byte[] slipDecode(byte[] frame) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(frame.length);
        boolean esc = false;
        for (byte b : frame) {
            int v = b & 0xFF;
            if (esc) {
                if (v == SLIP_ESC_END) {
                    out.write(SLIP_END);
                } else if (v == SLIP_ESC_ESC) {
                    out.write(SLIP_ESC);
                } else {
                    throw new IOException("Invalid SLIP escape sequence.");
                }
                esc = false;
            } else if (v == SLIP_ESC) {
                esc = true;
            } else {
                out.write(v);
            }
        }
        if (esc) {
            throw new IOException("Truncated SLIP escape sequence.");
        }
        return out.toByteArray();
    }

    private static void enterBootloader(UsbSerialPort port) throws IOException, InterruptedException {
        port.setDTR(false);
        port.setRTS(true);
        Thread.sleep(100);
        port.setDTR(true);
        port.setRTS(false);
        Thread.sleep(100);
        port.setDTR(false);
        port.setRTS(false);
        Thread.sleep(350);
    }

    private static void sync(UsbSerialPort port, ProgressSink progress) throws Exception {
        byte[] syncData = new byte[36];
        syncData[0] = 0x07;
        syncData[1] = 0x07;
        syncData[2] = 0x12;
        syncData[3] = 0x20;
        Arrays.fill(syncData, 4, syncData.length, (byte) 0x55);

        Exception last = null;
        for (int attempt = 1; attempt <= 7; attempt++) {
            progress.onProgress(String.format(Locale.US, "Syncing ESP bootloader (%d/7)... (5%%)", attempt));
            try {
                command(port, SYNC, syncData, 0, 1_500);
                progress.onProgress("ESP bootloader synced. (10%)");
                return;
            } catch (Exception e) {
                last = e;
                Thread.sleep(120);
            }
        }
        throw new IOException("Could not sync ESP bootloader. Hold BOOT, tap RESET, then retry.", last);
    }

    private static int flashImage(
            UsbSerialPort port,
            byte[] image,
            int offset,
            int writtenBefore,
            int totalBytes,
            String label,
            ProgressSink progress
    ) throws Exception {
        int blocks = (image.length + BLOCK_SIZE - 1) / BLOCK_SIZE;
        ByteArrayOutputStream begin = new ByteArrayOutputStream();
        writeLe32(begin, image.length);
        writeLe32(begin, blocks);
        writeLe32(begin, BLOCK_SIZE);
        writeLe32(begin, offset);
        progress.onProgress(String.format(Locale.US, "Preparing ESP %s write at 0x%05X... (%d%%)",
                label, offset, flashPct(writtenBefore, totalBytes)));
        command(port, FLASH_BEGIN, begin.toByteArray(), 0, 10_000);

        for (int seq = 0; seq < blocks; seq++) {
            int start = seq * BLOCK_SIZE;
            int len = Math.min(BLOCK_SIZE, image.length - start);
            byte[] block = new byte[BLOCK_SIZE];
            System.arraycopy(image, start, block, 0, len);

            ByteArrayOutputStream data = new ByteArrayOutputStream(16 + BLOCK_SIZE);
            writeLe32(data, BLOCK_SIZE);
            writeLe32(data, seq);
            writeLe32(data, 0);
            writeLe32(data, 0);
            data.write(block, 0, block.length);

            int pct = flashPct(writtenBefore + Math.min(image.length, (seq + 1) * BLOCK_SIZE), totalBytes);
            progress.onProgress(String.format(Locale.US, "Writing ESP %s block %d/%d... (%d%%)", label, seq + 1, blocks, pct));
            command(port, FLASH_DATA, data.toByteArray(), checksum(block), 10_000);
        }
        return image.length;
    }

    private static int flashPct(int writtenBytes, int totalBytes) {
        return 12 + (int) Math.min(86L, (writtenBytes * 86L) / Math.max(1, totalBytes));
    }

    private static void command(UsbSerialPort port, int op, byte[] data, int checksum, int timeoutMs) throws Exception {
        byte[] request = packet(op, data, checksum);
        port.write(request, timeoutMs);
        readResponse(port, op, timeoutMs);
    }

    private static byte[] packet(int op, byte[] data, int checksum) {
        ByteArrayOutputStream body = new ByteArrayOutputStream(8 + data.length);
        body.write(0x00);
        body.write(op & 0xFF);
        body.write(data.length & 0xFF);
        body.write((data.length >> 8) & 0xFF);
        writeLe32(body, checksum);
        body.write(data, 0, data.length);
        return slipEncode(body.toByteArray());
    }

    private static void readResponse(UsbSerialPort port, int op, int timeoutMs) throws Exception {
        long deadline = System.currentTimeMillis() + timeoutMs;
        ByteArrayOutputStream frame = new ByteArrayOutputStream();
        boolean inFrame = false;
        byte[] tmp = new byte[256];
        while (System.currentTimeMillis() < deadline) {
            int n = port.read(tmp, Math.max(100, Math.min(500, timeoutMs)));
            for (int i = 0; i < n; i++) {
                int b = tmp[i] & 0xFF;
                if (b == SLIP_END) {
                    if (inFrame && frame.size() > 0) {
                        byte[] decoded = slipDecode(frame.toByteArray());
                        if (isResponseFor(decoded, op)) {
                            return;
                        }
                        frame.reset();
                    }
                    inFrame = true;
                } else if (inFrame) {
                    frame.write(b);
                }
            }
        }
        throw new IOException("Timed out waiting for ESP command response.");
    }

    private static boolean isResponseFor(byte[] decoded, int op) {
        return decoded.length >= 8 && (decoded[0] & 0xFF) == 0x01 && (decoded[1] & 0xFF) == (op & 0xFF);
    }

    private static byte[] readRequiredAsset(AssetManager assets, String path) throws IOException {
        byte[] image = readAsset(assets, path);
        if (image.length == 0) {
            throw new IOException("Bundled ESP firmware image is empty: " + path);
        }
        return image;
    }

    private static byte[] readAsset(AssetManager assets, String path) throws IOException {
        try (InputStream in = assets.open(path);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static byte[] le32(int value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(4);
        writeLe32(out, value);
        return out.toByteArray();
    }

    private static void writeLe32(ByteArrayOutputStream out, int value) {
        out.write(value & 0xFF);
        out.write((value >> 8) & 0xFF);
        out.write((value >> 16) & 0xFF);
        out.write((value >> 24) & 0xFF);
    }

    private static String lower(@Nullable String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.US);
    }

    static String normalizeBoardType(@Nullable String value) {
        String lower = lower(value).replace("-", "");
        if ("esp32s3".equals(lower)) {
            return "esp32s3";
        }
        if ("esp32s2".equals(lower)) {
            return "esp32s2";
        }
        if ("esp32".equals(lower)) {
            return "esp32";
        }
        return lower;
    }
}
