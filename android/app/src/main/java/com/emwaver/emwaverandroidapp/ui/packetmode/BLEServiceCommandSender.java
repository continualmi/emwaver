package com.emwaver.emwaverandroidapp.ui.packetmode;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.CommandSender;

public class BLEServiceCommandSender implements CommandSender {
    private final BLEService bleService;

    public BLEServiceCommandSender(BLEService bleService) {
        this.bleService = bleService;
    }

    @Override
    public byte[] sendCommandAndGetResponse(byte[] command, int expectedResponseSize, int busyDelay, long timeoutMillis) {
        if (bleService == null || !bleService.checkConnection()) {
            return null;
        }
        
        // Use BLEService's sendCommand method which handles the response waiting
        return bleService.sendCommand(command, (int) timeoutMillis);
    }
}
