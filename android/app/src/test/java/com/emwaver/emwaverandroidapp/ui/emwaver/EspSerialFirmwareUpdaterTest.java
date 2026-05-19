package com.emwaver.emwaverandroidapp.ui.emwaver;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

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
}
