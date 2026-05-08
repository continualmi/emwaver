package com.emwaver.emwaverandroidapp.ui.emwaver;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateDeviceDialogFragmentTest {
    @Test
    public void espBoardTypeIncludesS2S3AndGenericEsp32() {
        assertTrue(UpdateDeviceDialogFragment.isEspBoardType("esp32"));
        assertTrue(UpdateDeviceDialogFragment.isEspBoardType(" esp32s2 "));
        assertTrue(UpdateDeviceDialogFragment.isEspBoardType("ESP32S3"));
        assertFalse(UpdateDeviceDialogFragment.isEspBoardType("stm32f042"));
        assertFalse(UpdateDeviceDialogFragment.isEspBoardType(null));
    }

    @Test
    public void espUpdateUnavailableMessageIsNotS3Specific() {
        String message = UpdateDeviceDialogFragment.espUpdateUnavailableMessage();
        assertTrue(message.contains("ESP32 flashing"));
        assertFalse(message.contains("ESP32-S3"));
    }
}
