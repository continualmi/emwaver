package com.emwaver.emwaverandroidapp.ui.ism;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.preference.PreferenceManager;
import android.util.Log;

import com.emwaver.emwaverandroidapp.BLEService;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.function.Consumer;

public class RFM69 {

    private static final String TAG = "RFM69";
    private final BLEService bleService;
    private final Context context;

    // Register definitions - Keep these for IsmFragment's register dump loop
    public static final byte REG_FIFO = 0x00;
    public static final byte REG_OPMODE = 0x01;
    public static final byte REG_DATAMODUL = 0x02;
    public static final byte REG_BITRATEMSB = 0x03;
    public static final byte REG_BITRATELSB = 0x04;
    public static final byte REG_FDEVMSB = 0x05;
    public static final byte REG_FDEVLSB = 0x06;
    public static final byte REG_FRFMSB = 0x07;
    public static final byte REG_FRFMID = 0x08;
    public static final byte REG_FRFLSB = 0x09;
    public static final byte REG_OSC1 = 0x0A;
    public static final byte REG_AFCCTRL = 0x0B;
    public static final byte REG_LOWBAT = 0x0C;
    public static final byte REG_LISTEN1 = 0x0D;
    public static final byte REG_LISTEN2 = 0x0E;
    public static final byte REG_LISTEN3 = 0x0F;
    public static final byte REG_VERSION = 0x10;
    public static final byte REG_PALEVEL = 0x11;
    public static final byte REG_PARAMP = 0x12;
    public static final byte REG_OCP = 0x13;
    public static final byte REG_LNA = 0x18;
    public static final byte REG_RXBW = 0x19;
    public static final byte REG_AFCBW = 0x1A;
    public static final byte REG_OOKPEAK = 0x1B;
    public static final byte REG_OOKAVG = 0x1C;
    public static final byte REG_OOKFIX = 0x1D;
    public static final byte REG_AFCFEI = 0x1E;
    public static final byte REG_AFCMSB = 0x1F;
    public static final byte REG_AFCLSB = 0x20;
    public static final byte REG_FEIMSB = 0x21;
    public static final byte REG_FEILSB = 0x22;
    public static final byte REG_RSSICONFIG = 0x23;
    public static final byte REG_RSSIVALUE = 0x24;
    public static final byte REG_DIOMAPPING1 = 0x25;
    public static final byte REG_DIOMAPPING2 = 0x26;
    public static final byte REG_IRQFLAGS1 = 0x27;
    public static final byte REG_IRQFLAGS2 = 0x28;
    public static final byte REG_RSSITHRESH = 0x29;
    public static final byte REG_RXTIMEOUT1 = 0x2A;
    public static final byte REG_RXTIMEOUT2 = 0x2B;
    public static final byte REG_PREAMBLEMSB = 0x2C;
    public static final byte REG_PREAMBLELSB = 0x2D;
    public static final byte REG_SYNCCONFIG = 0x2E;
    public static final byte REG_SYNCVALUE1 = 0x2F;
    public static final byte REG_PACKETCONFIG1 = 0x37;
    public static final byte REG_PAYLOADLENGTH = 0x38;
    public static final byte REG_NODEADRS = 0x39;
    public static final byte REG_BROADCASTADRS = 0x3A;
    public static final byte REG_AUTOMODES = 0x3B;
    public static final byte REG_FIFOTHRESH = 0x3C;
    public static final byte REG_PACKETCONFIG2 = 0x3D;
    public static final byte REG_TEMP1 = 0x4E;
    public static final byte REG_TEMP2 = 0x4F;
    public static final byte REG_TESTLNA = 0x58;
    public static final byte REG_TESTPA1 = 0x5A;
    public static final byte REG_TESTPA2 = 0x5C;
    public static final byte REG_TESTDAGC = 0x6F;

    // Modes
    public static final int MODE_SLEEP = 0;
    public static final int MODE_STANDBY = 1;
    public static final int MODE_SYNTH = 2;
    public static final int MODE_RX = 3;
    public static final int MODE_TX = 4;

    // Modulation types
    public static final int MOD_FSK = 0;
    public static final int MOD_OOK = 1;

    private boolean deviceOpen = false;
    private Consumer<String> commandObserver;

    public RFM69(BLEService bleService) {
        this.bleService = bleService;
        this.context = bleService.getApplicationContext();
    }

    public void setCommandObserver(Consumer<String> observer) {
        this.commandObserver = observer;
    }

    public void clearCommandObserver(Consumer<String> observer) {
        if (this.commandObserver == observer) {
            this.commandObserver = null;
        }
    }

    public boolean openDevice() {
        if (deviceOpen) return true;

        SharedPreferences preferences = PreferenceManager.getDefaultSharedPreferences(context);
        String csPin = preferences.getString("rfm69_cs_pin", "10");
        boolean csActiveHigh = preferences.getBoolean("rfm69_cs_active_high", false);

        String command = "rfm69 init --cs=" + csPin + " --cs_active_high=" + (csActiveHigh ? "1" : "0");
        byte[] response = sendCommand(command, 1000);
        
        if (isOk(response)) {
            deviceOpen = true;
            Log.i(TAG, "RFM69 initialized successfully with CS=" + csPin + " ActiveHigh=" + csActiveHigh);
            return true;
        }

        Log.e(TAG, "Failed to initialize RFM69");
        return false;
    }

    public boolean closeDevice() {
        // No explicit close command in new firmware logic yet, 
        // as the device handle is managed statically in C.
        // We just reset our local flag.
        deviceOpen = false;
        return true;
    }

    public byte readReg(byte addr) {
        String command = String.format(Locale.US, "rfm69 read --reg=%d", addr & 0xFF);
        byte[] response = sendCommand(command, 1000);
        byte[] parsed = parseOkResponse(response);
        if (parsed.length > 0) {
            return parsed[0];
        }
        return 0;
    }

    public void writeReg(byte addr, byte value) {
        String command = String.format(Locale.US, "rfm69 write --reg=%d --val=%d", addr & 0xFF, value & 0xFF);
        sendCommand(command, 1000);
    }

    public void setMode(int mode) {
        String modeStr;
        switch (mode) {
            case MODE_TX: modeStr = "tx"; break;
            case MODE_RX: modeStr = "rx"; break;
            case MODE_SYNTH: modeStr = "synth"; break;
            case MODE_STANDBY: modeStr = "standby"; break;
            case MODE_SLEEP: modeStr = "sleep"; break;
            default: return;
        }
        sendCommand("rfm69 set_mode --mode=" + modeStr, 1000);
    }

    public void setFrequencyMHz(float freqMHz) {
        sendCommand(String.format(Locale.US, "rfm69 set_freq --mhz=%.6f", freqMHz), 1000);
    }

    public double getFrequency() {
        byte[] response = sendCommand("rfm69 get_freq", 1000);
        String str = parseStringResponse(response);
        try {
            return Double.parseDouble(str);
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }

    public void setDataRate(int bps) {
        sendCommand("rfm69 set_bitrate --bps=" + bps, 1000);
    }

    public int getDataRate() {
        byte[] response = sendCommand("rfm69 get_bitrate", 1000);
        String str = parseStringResponse(response);
        try {
            return Integer.parseInt(str);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public void setDeviation(int deviationHz) {
        sendCommand("rfm69 set_dev --hz=" + deviationHz, 1000);
    }

    public int getDeviation() {
        byte[] response = sendCommand("rfm69 get_dev", 1000);
        String str = parseStringResponse(response);
        try {
            return Integer.parseInt(str);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public void setBandwidth(byte bw) {
        // Here we just send the register value directly as 'val' if we used a raw setter,
        // but our C command 'set_bw' expects the register value directly for now.
        sendCommand("rfm69 set_bw --val=" + (bw & 0xFF), 1000);
    }

    public byte getBandwidth() {
        byte[] response = sendCommand("rfm69 get_bw", 1000);
        String str = parseStringResponse(response);
        try {
            return (byte) Integer.parseInt(str);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    public void setModulation(int modulation) {
        String modStr = (modulation == MOD_OOK) ? "ook" : "fsk";
        sendCommand("rfm69 set_mod --mod=" + modStr, 1000);
    }

    public int getModulation() {
        byte[] response = sendCommand("rfm69 get_mod", 1000);
        String str = parseStringResponse(response);
        return "ook".equals(str) ? MOD_OOK : MOD_FSK;
    }

    public void setTransmitPower(int dbm, int paMode, boolean ocp) {
        // We simplified the C side to just take dbm.
        // If we want to support paMode/ocp we need to enhance the C side.
        // For now, just send dbm.
        sendCommand("rfm69 set_power --dbm=" + dbm, 1000);
    }

    public int getPowerLevel() {
        byte[] response = sendCommand("rfm69 get_power", 1000);
        String str = parseStringResponse(response);
        try {
            return Integer.parseInt(str);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // These legacy setters might not map directly if not implemented in C,
    // or if they just write registers directly.
    public void setLNAGain(byte lnaGain) {
        writeReg(REG_LNA, (byte)(0x00 | lnaGain)); // simplified
    }

    public void setFixedThreshold(byte threshold) {
        writeReg(REG_OOKFIX, threshold);
    }

    public void setRSSIThreshold(byte rssi) {
        writeReg(REG_RSSITHRESH, rssi);
    }

    public void setSensitivityBoost(boolean boost) {
         if (boost) {
            writeReg(REG_TESTLNA, (byte)0x2D);
        } else {
            writeReg(REG_TESTLNA, (byte)0x1B);
        }
    }
    
    // ... other legacy methods can use writeReg directly.

    private void notifyCommandObserver(String command) {
        if (commandObserver != null) {
            commandObserver.accept(command);
        }
    }

    private byte[] sendCommand(String command, int timeoutMs) {
        notifyCommandObserver(command);
        byte[] rawResponse = bleService.sendCommand((command + "\n").getBytes(StandardCharsets.UTF_8), timeoutMs);
        if (rawResponse == null || rawResponse.length == 0) {
            Log.e(TAG, "Received empty response for command: " + command);
            return new byte[0];
        }
        return rawResponse;
    }

    private boolean isOk(byte[] response) {
        if (response == null || response.length == 0) return false;
        String str = new String(response, StandardCharsets.UTF_8).trim();
        return str.startsWith("ok");
    }

    private byte[] parseOkResponse(byte[] response) {
        if (response == null || response.length == 0) return new byte[0];
        String str = new String(response, StandardCharsets.UTF_8).trim();
        if (!str.startsWith("ok")) return new byte[0];
        
        String payload = str.length() > 2 ? str.substring(2).trim() : "";
        if (payload.isEmpty()) return new byte[0];

        // Parse hex tokens
        String[] tokens = payload.split("[\\s,]+");
        byte[] result = new byte[tokens.length];
        for (int i=0; i<tokens.length; i++) {
            try {
                result[i] = (byte) Integer.parseInt(tokens[i], 16);
            } catch (NumberFormatException e) {
                // ignore
            }
        }
        return result;
    }

    private String parseStringResponse(byte[] response) {
        if (response == null || response.length == 0) return "";
        String str = new String(response, StandardCharsets.UTF_8).trim();
        if (!str.startsWith("ok")) return "";
        return str.length() > 2 ? str.substring(2).trim() : "";
    }
}