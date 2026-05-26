package com.emwaver.emwaverandroidapp.ui.emwaver;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.IOException;

import org.junit.Test;

public class EspSerialFirmwareUpdaterTest {
    @Test
    public void checksumUsesEspRomSeedXor() {
        assertEquals(0xEF, EspSerialFirmwareUpdater.checksum(new byte[0]));
        assertEquals(0xEF ^ 0x01 ^ 0x02 ^ 0x7F,
                EspSerialFirmwareUpdater.checksum(new byte[]{0x01, 0x02, 0x7F}));
    }

    @Test
    public void slipEncodeEscapesFrameAndEscapeBytes() throws Exception {
        byte[] payload = new byte[]{0x01, (byte) 0xC0, 0x02, (byte) 0xDB};
        byte[] encoded = EspSerialFirmwareUpdater.slipEncode(payload);
        assertArrayEquals(new byte[]{
                (byte) 0xC0,
                0x01,
                (byte) 0xDB, (byte) 0xDC,
                0x02,
                (byte) 0xDB, (byte) 0xDD,
                (byte) 0xC0
        }, encoded);

        byte[] innerFrame = new byte[encoded.length - 2];
        System.arraycopy(encoded, 1, innerFrame, 0, innerFrame.length);
        assertArrayEquals(payload, EspSerialFirmwareUpdater.slipDecode(innerFrame));
    }

    @Test
    public void firmwareAssetsMatchDesktopEspFlashLayout() throws Exception {
        EspSerialFirmwareUpdater.FirmwareAssets esp32 = EspSerialFirmwareUpdater.assetsForBoardType("esp32");
        assertEquals(EspSerialFirmwareUpdater.ESP_BOOTLOADER_OFFSET, esp32.bootloaderOffset);
        assertEquals("firmware/emwaver-esp32-bootloader.bin", esp32.bootloaderAsset);
        assertEquals("firmware/emwaver-esp32-partition-table.bin", esp32.partitionTableAsset);
        assertEquals("firmware/emwaver-esp32-ota-data.bin", esp32.otaDataAsset);
        assertEquals("firmware/emwaver-esp32-app.bin", esp32.appAsset);

        EspSerialFirmwareUpdater.FirmwareAssets esp32s2 = EspSerialFirmwareUpdater.assetsForBoardType("esp32-s2");
        assertEquals(EspSerialFirmwareUpdater.ESP_BOOTLOADER_OFFSET, esp32s2.bootloaderOffset);
        assertEquals("firmware/emwaver-esp32s2-app.bin", esp32s2.appAsset);

        EspSerialFirmwareUpdater.FirmwareAssets esp32s3 = EspSerialFirmwareUpdater.assetsForBoardType("ESP32-S3");
        assertEquals(EspSerialFirmwareUpdater.ESP32S3_BOOTLOADER_OFFSET, esp32s3.bootloaderOffset);
        assertEquals("firmware/emwaver-esp32s3-app.bin", esp32s3.appAsset);
        assertEquals(0x8000, EspSerialFirmwareUpdater.PARTITION_TABLE_OFFSET);
        assertEquals(0x10000, EspSerialFirmwareUpdater.OTA_DATA_OFFSET);
        assertEquals(0x20000, EspSerialFirmwareUpdater.APP_OFFSET);
    }

    @Test
    public void firmwareAssetsRejectUnknownBoardType() {
        assertThrows(IOException.class, () -> EspSerialFirmwareUpdater.assetsForBoardType("stm32f042"));
    }
}
