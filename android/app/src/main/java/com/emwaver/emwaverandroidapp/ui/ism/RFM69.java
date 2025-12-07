package com.emwaver.emwaverandroidapp.ui.ism;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.preference.PreferenceManager;

import com.emwaver.emwaverandroidapp.BLEService;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.function.Consumer;

public class RFM69 {

    private static final String TAG = "RFM69";
    private final BLEService bleService;
    private final Context context;

    // Register definitions
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

    // OpMode bits
    public static final byte RF_OPMODE_SEQUENCER_OFF = (byte)0x80;
    public static final byte RF_OPMODE_SEQUENCER_ON = 0x00;
    public static final byte RF_OPMODE_LISTEN_ON = 0x40;
    public static final byte RF_OPMODE_LISTEN_OFF = 0x00;
    public static final byte RF_OPMODE_LISTENABORT = 0x20;
    public static final byte RF_OPMODE_SLEEP = 0x00;
    public static final byte RF_OPMODE_STANDBY = 0x04;
    public static final byte RF_OPMODE_SYNTHESIZER = 0x08;
    public static final byte RF_OPMODE_TRANSMITTER = 0x0C;
    public static final byte RF_OPMODE_RECEIVER = 0x10;

    // DataModul bits
    public static final byte RF_DATAMODUL_DATAMODE_PACKET = 0x00;
    public static final byte RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC = 0x40;
    public static final byte RF_DATAMODUL_DATAMODE_CONTINUOUS = 0x60;
    public static final byte RF_DATAMODUL_MODULATIONTYPE_FSK = 0x00;
    public static final byte RF_DATAMODUL_MODULATIONTYPE_OOK = 0x08;
    public static final byte RF_DATAMODUL_MODULATIONSHAPING_00 = 0x00;

    // PaLevel bits
    public static final byte RF_PALEVEL_PA0_ON = (byte)0x80;
    public static final byte RF_PALEVEL_PA0_OFF = 0x00;
    public static final byte RF_PALEVEL_PA1_ON = 0x40;
    public static final byte RF_PALEVEL_PA1_OFF = 0x00;
    public static final byte RF_PALEVEL_PA2_ON = 0x20;
    public static final byte RF_PALEVEL_PA2_OFF = 0x00;

    // OCP bits
    public static final byte RF_OCP_ON = 0x1A;
    public static final byte RF_OCP_OFF = 0x0F;

    // LNA bits
    public static final byte RF_LNA_ZIN_50 = 0x00;
    public static final byte RF_LNA_ZIN_200 = (byte)0x80;
    public static final byte RF_LNA_GAINSELECT_AUTO = 0x00;
    public static final byte RF_LNA_GAINSELECT_MAX = 0x08;
    public static final byte RF_LNA_GAINSELECT_MAXMINUS6 = 0x10;
    public static final byte RF_LNA_GAINSELECT_MAXMINUS12 = 0x18;
    public static final byte RF_LNA_GAINSELECT_MAXMINUS24 = 0x20;
    public static final byte RF_LNA_GAINSELECT_MAXMINUS36 = 0x28;
    public static final byte RF_LNA_GAINSELECT_MAXMINUS48 = 0x30;

    // OokPeak bits
    public static final byte RF_OOKPEAK_THRESHTYPE_FIXED = 0x00;
    public static final byte RF_OOKPEAK_THRESHTYPE_PEAK = 0x40;
    public static final byte RF_OOKPEAK_PEAKTHRESHSTEP_000 = 0x00;
    public static final byte RF_OOKPEAK_PEAKTHRESHDEC_000 = 0x00;

    // RSSI Config bits
    public static final byte RF_RSSI_START = 0x01;
    public static final byte RF_RSSI_DONE = 0x02;

    // IrqFlags1 bits
    public static final byte RF_IRQFLAGS1_MODEREADY = (byte)0x80;

    // Modes
    public static final int MODE_SLEEP = 0;
    public static final int MODE_STANDBY = 1;
    public static final int MODE_SYNTH = 2;
    public static final int MODE_RX = 3;
    public static final int MODE_TX = 4;

    // Modulation types
    public static final int MOD_FSK = 0;
    public static final int MOD_OOK = 1;

    // PA modes
    public static final int PA_MODE_PA0 = 1;
    public static final int PA_MODE_PA1 = 2;
    public static final int PA_MODE_PA1_PA2 = 3;
    public static final int PA_MODE_PA1_PA2_20DBM = 4;

    // Frequency step (FXOSC / 2^19)
    private static final double FSTEP = 61.03515625;

    private static final String DEVICE_NAME = "rfm69";
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
        if (deviceOpen) {
            Log.i(TAG, "RFM69 device already open");
            return true;
        }

        SharedPreferences preferences = PreferenceManager.getDefaultSharedPreferences(context);
        String csPin = preferences.getString("rfm69_cs_pin", "10");
        boolean csActiveHigh = preferences.getBoolean("rfm69_cs_active_high", false);

        String command = "spi open --name=" + DEVICE_NAME +
                " --host=2 --miso=13 --mosi=11 --sck=12 --cs=" + csPin +
                " --mode=0 --clock=8000000 --cs_active_high=" + (csActiveHigh ? "1" : "0");

        String responseStr = executeOpenCommand(command);
        if (responseStr != null && responseStr.startsWith("ok")) {
            deviceOpen = true;
            Log.i(TAG, "RFM69 SPI device opened successfully with CS pin " + csPin +
                    " (active " + (csActiveHigh ? "high" : "low") + ")");
            return true;
        }

        if (responseStr != null && responseStr.contains("spi open: exists")) {
            Log.w(TAG, "SPI device already open on firmware; attempting to close and retry");
            sendCloseCommandToFirmware();
            responseStr = executeOpenCommand(command);
            if (responseStr != null && responseStr.startsWith("ok")) {
                deviceOpen = true;
                Log.i(TAG, "RFM69 SPI device opened successfully after retry with CS pin " + csPin +
                        " (active " + (csActiveHigh ? "high" : "low") + ")");
                return true;
            }
        }

        Log.e(TAG, "Failed to open RFM69 SPI device" +
                (responseStr != null ? (": " + responseStr) : " (no response)"));
        return false;
    }

    public boolean closeDevice() {
        boolean success = sendCloseCommandToFirmware();
        if (success) {
            deviceOpen = false;
            Log.i(TAG, "RFM69 SPI device closed successfully");
            return true;
        }

        if (!deviceOpen) {
            return true;
        }

        Log.e(TAG, "Failed to close RFM69 SPI device");
        return false;
    }

    public byte readReg(byte addr) {
        String txData = formatHexBytes(new byte[]{(byte)(addr & 0x7F), 0x00});
        String command = "spi xfer --name=" + DEVICE_NAME + " --tx=" + txData + " --rx=2";
        if (!deviceOpen) {
            Log.w(TAG, "Attempting to read register while device is closed; opening now");
            if (!openDevice()) {
                Log.e(TAG, "Failed to open device before register read");
                return 0;
            }
        }

        byte[] response = sendSpiCommand(command, 1000);
        byte[] parsed = parseOkResponse(response);
        if (parsed.length > 0) {
            return parsed[parsed.length - 1];
        }

        Log.e(TAG, "Empty parsed response for register 0x" + String.format(Locale.US, "%02X", addr));
        return 0;
    }

    public void writeReg(byte addr, byte value) {
        if (!deviceOpen) {
            Log.w(TAG, "Attempting to write register while device is closed; opening now");
            if (!openDevice()) {
                Log.e(TAG, "Failed to open device before register write");
                return;
            }
        }

        String txData = formatHexBytes(new byte[]{(byte)(addr | 0x80), value});
        String command = "spi xfer --name=" + DEVICE_NAME + " --tx=" + txData;
        sendSpiCommand(command, 1000);
    }

    public void setMode(int mode) {
        byte currentOpMode = readReg(REG_OPMODE);
        byte newOpMode;

        switch (mode) {
            case MODE_TX:
                newOpMode = (byte)((currentOpMode & 0xE3) | RF_OPMODE_TRANSMITTER);
                break;
            case MODE_RX:
                newOpMode = (byte)((currentOpMode & 0xE3) | RF_OPMODE_RECEIVER);
                writeReg(REG_TESTPA1, (byte)0x55);
                writeReg(REG_TESTPA2, (byte)0x70);
                writeReg(REG_OCP, RF_OCP_ON);
                break;
            case MODE_SYNTH:
                newOpMode = (byte)((currentOpMode & 0xE3) | RF_OPMODE_SYNTHESIZER);
                break;
            case MODE_STANDBY:
                newOpMode = (byte)((currentOpMode & 0xE3) | RF_OPMODE_STANDBY);
                break;
            case MODE_SLEEP:
                newOpMode = (byte)((currentOpMode & 0xE3) | RF_OPMODE_SLEEP);
                break;
            default:
                return;
        }

        writeReg(REG_OPMODE, newOpMode);
    }

    public void setFrequencyMHz(float freqMHz) {
        long freqHz = (long)(freqMHz / FSTEP * 1000000.0);
        writeReg(REG_FRFMSB, (byte)(freqHz >> 16));
        writeReg(REG_FRFMID, (byte)(freqHz >> 8));
        writeReg(REG_FRFLSB, (byte)freqHz);
    }

    public double getFrequency() {
        long frfMsb = readReg(REG_FRFMSB) & 0xFF;
        long frfMid = readReg(REG_FRFMID) & 0xFF;
        long frfLsb = readReg(REG_FRFLSB) & 0xFF;
        long freqHz = (frfMsb << 16) + (frfMid << 8) + frfLsb;
        return (FSTEP * freqHz) / 1000000.0;
    }

    public void setDataRate(int bps) {
        if (bps <= 0) return;
        long bitrate = 32000000L / bps;
        writeReg(REG_BITRATEMSB, (byte)(bitrate >> 8));
        writeReg(REG_BITRATELSB, (byte)bitrate);
    }

    public int getDataRate() {
        int msb = readReg(REG_BITRATEMSB) & 0xFF;
        int lsb = readReg(REG_BITRATELSB) & 0xFF;
        int bitrate = (msb << 8) | lsb;
        if (bitrate == 0) return 0;
        return (int)(32000000L / bitrate);
    }

    public void setDeviation(int deviationHz) {
        long deviation = deviationHz / 61;
        writeReg(REG_FDEVMSB, (byte)(deviation >> 8));
        writeReg(REG_FDEVLSB, (byte)deviation);
    }

    public int getDeviation() {
        int msb = readReg(REG_FDEVMSB) & 0xFF;
        int lsb = readReg(REG_FDEVLSB) & 0xFF;
        return ((msb << 8) | lsb) * 61;
    }

    public void setBandwidth(byte bw) {
        byte currentRxBw = readReg(REG_RXBW);
        writeReg(REG_RXBW, (byte)((currentRxBw & 0xE0) | bw));
    }

    public byte getBandwidth() {
        return (byte)(readReg(REG_RXBW) & 0x1F);
    }

    public void setModulation(int modulation) {
        if (modulation == MOD_OOK) {
            writeReg(REG_DATAMODUL, (byte)(RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
                    RF_DATAMODUL_MODULATIONTYPE_OOK | RF_DATAMODUL_MODULATIONSHAPING_00));
        } else {
            writeReg(REG_DATAMODUL, (byte)(RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC |
                    RF_DATAMODUL_MODULATIONTYPE_FSK | RF_DATAMODUL_MODULATIONSHAPING_00));
        }
    }

    public int getModulation() {
        byte dataModul = readReg(REG_DATAMODUL);
        return ((dataModul & RF_DATAMODUL_MODULATIONTYPE_OOK) != 0) ? MOD_OOK : MOD_FSK;
    }

    public void setTransmitPower(int dbm, int paMode, boolean ocp) {
        byte paLevel;
        switch (paMode) {
            case PA_MODE_PA0:
                paLevel = (byte)(RF_PALEVEL_PA0_ON | RF_PALEVEL_PA1_OFF | RF_PALEVEL_PA2_OFF |
                        (dbm > 13 ? 31 : (dbm + 18)));
                break;
            case PA_MODE_PA1:
                paLevel = (byte)(RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_OFF |
                        (dbm > 13 ? 31 : (dbm + 18)));
                break;
            case PA_MODE_PA1_PA2:
                paLevel = (byte)(RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON |
                        (dbm > 17 ? 31 : (dbm + 14)));
                break;
            case PA_MODE_PA1_PA2_20DBM:
                writeReg(REG_TESTPA1, (byte)0x5D);
                writeReg(REG_TESTPA2, (byte)0x7C);
                paLevel = (byte)(RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON |
                        (dbm > 20 ? 31 : (dbm + 11)));
                break;
            default:
                paLevel = (byte)(RF_PALEVEL_PA0_OFF | RF_PALEVEL_PA1_ON | RF_PALEVEL_PA2_ON | 31);
                break;
        }
        writeReg(REG_PALEVEL, paLevel);
        writeReg(REG_OCP, ocp ? RF_OCP_ON : RF_OCP_OFF);
    }

    public int getPowerLevel() {
        byte paLevel = readReg(REG_PALEVEL);
        int outputPower = paLevel & 0x1F;

        boolean pa0 = (paLevel & RF_PALEVEL_PA0_ON) != 0;
        boolean pa1 = (paLevel & RF_PALEVEL_PA1_ON) != 0;
        boolean pa2 = (paLevel & RF_PALEVEL_PA2_ON) != 0;

        byte testPa1 = readReg(REG_TESTPA1);
        byte testPa2 = readReg(REG_TESTPA2);
        boolean is20dBm = (testPa1 == (byte)0x5D) && (testPa2 == (byte)0x7C);

        if (pa0 && !pa1 && !pa2) {
            return outputPower - 18;
        } else if (!pa0 && pa1 && !pa2) {
            return outputPower - 18;
        } else if (!pa0 && pa1 && pa2) {
            if (is20dBm) {
                return outputPower - 11;
            } else {
                return outputPower - 14;
            }
        }
        return 0;
    }

    public void setLNAGain(byte lnaGain) {
        writeReg(REG_LNA, (byte)(RF_LNA_ZIN_50 | lnaGain));
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

    public void setThreshTypeFixed(boolean fixed) {
        if (fixed) {
            writeReg(REG_OOKPEAK, (byte)(RF_OOKPEAK_THRESHTYPE_FIXED |
                    RF_OOKPEAK_PEAKTHRESHSTEP_000 | RF_OOKPEAK_PEAKTHRESHDEC_000));
        } else {
            writeReg(REG_OOKPEAK, (byte)(RF_OOKPEAK_THRESHTYPE_PEAK |
                    RF_OOKPEAK_PEAKTHRESHSTEP_000 | RF_OOKPEAK_PEAKTHRESHDEC_000));
        }
    }

    public int readRSSI(boolean forceTrigger) {
        if (forceTrigger) {
            writeReg(REG_RSSICONFIG, RF_RSSI_START);
            int timeout = 0;
            while ((readReg(REG_RSSICONFIG) & RF_RSSI_DONE) == 0x00) {
                try {
                    Thread.sleep(1);
                } catch (InterruptedException e) {
                    break;
                }
                if (++timeout > 100) break;
            }
        }
        return -((readReg(REG_RSSIVALUE) & 0xFF) >> 1);
    }

    private String formatHexBytes(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(String.format("0x%02X", bytes[i] & 0xFF));
        }
        return sb.toString();
    }

    private byte[] parseOkResponse(byte[] response) {
        if (response == null || response.length == 0) {
            return new byte[0];
        }

        String responseStr = new String(response, StandardCharsets.UTF_8).trim();
        if (!responseStr.startsWith("ok")) {
            Log.e(TAG, "Command failed: " + responseStr);
            return new byte[0];
        }

        String payload = responseStr.length() > 2 ? responseStr.substring(2).trim() : "";
        if (payload.isEmpty()) {
            return new byte[0];
        }

        String[] tokens = payload.split("[\\s,]+");
        byte[] result = new byte[tokens.length];
        int count = 0;

        for (String token : tokens) {
            if (token.isEmpty()) {
                continue;
            }
            try {
                String hexStr = token.replace("0x", "").replace("0X", "");
                result[count++] = (byte) Integer.parseInt(hexStr, 16);
            } catch (NumberFormatException e) {
                Log.e(TAG, "Failed to parse hex value: " + token);
            }
        }

        if (count == result.length) {
            return result;
        }

        byte[] trimmed = new byte[count];
        System.arraycopy(result, 0, trimmed, 0, count);
        return trimmed;
    }

    private void notifyCommandObserver(String command) {
        if (commandObserver != null) {
            commandObserver.accept(command);
        }
    }

    private byte[] sendSpiCommand(String command, int timeoutMs) {
        notifyCommandObserver(command);
        byte[] rawResponse = bleService.sendCommand((command + "\n").getBytes(StandardCharsets.UTF_8), timeoutMs);
        if (rawResponse == null || rawResponse.length == 0) {
            Log.e(TAG, "Received empty response for command: " + command);
            return new byte[0];
        }
        return rawResponse;
    }

    private String executeOpenCommand(String command) {
        byte[] response = sendSpiCommand(command, 1000);
        if (response == null || response.length == 0) {
            Log.e(TAG, "spi open returned empty response");
            return null;
        }
        String responseStr = new String(response, StandardCharsets.UTF_8).trim();
        Log.d(TAG, "spi open response: " + responseStr);
        return responseStr;
    }

    private boolean sendCloseCommandToFirmware() {
        String command = "spi close --name=" + DEVICE_NAME;
        byte[] response = sendSpiCommand(command, 1000);
        if (response == null || response.length == 0) {
            Log.w(TAG, "spi close returned empty response");
            return false;
        }
        String responseStr = new String(response, StandardCharsets.UTF_8).trim();
        Log.d(TAG, "spi close response: " + responseStr);
        return responseStr.startsWith("ok");
    }
}
