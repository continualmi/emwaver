package com.emwaver.emwaverandroidapp.ui.packetmode;

import android.util.Log;

import com.emwaver.emwaverandroidapp.CommandSender;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

public class CC1101 {
    private final CommandSender commandSender;

    // CC1101 Configuration Registers
    public static final byte CC1101_IOCFG2 = 0x00;       // GDO2 output pin configuration
    public static final byte CC1101_IOCFG1 = 0x01;       // GDO1 output pin configuration
    public static final byte CC1101_IOCFG0 = 0x02;       // GDO0 output pin configuration
    public static final byte CC1101_FIFOTHR = 0x03;      // RX FIFO and TX FIFO thresholds
    public static final byte CC1101_SYNC1 = 0x04;        // Sync word, high INT8U
    public static final byte CC1101_SYNC0 = 0x05;        // Sync word, low INT8U
    public static final byte CC1101_PKTLEN = 0x06;       // Packet length
    public static final byte CC1101_PKTCTRL1 = 0x07;     // Packet automation control
    public static final byte CC1101_PKTCTRL0 = 0x08;     // Packet automation control
    public static final byte CC1101_ADDR = 0x09;         // Device address
    public static final byte CC1101_CHANNR = 0x0A;       // Channel number
    public static final byte CC1101_FSCTRL1 = 0x0B;      // Frequency synthesizer control
    public static final byte CC1101_FSCTRL0 = 0x0C;      // Frequency synthesizer control
    public static final byte CC1101_FREQ2 = 0x0D;        // Frequency control word, high INT8U
    public static final byte CC1101_FREQ1 = 0x0E;        // Frequency control word, middle INT8U
    public static final byte CC1101_FREQ0 = 0x0F;        // Frequency control word, low INT8U
    public static final byte CC1101_MDMCFG4 = 0x10;      // Modem configuration
    public static final byte CC1101_MDMCFG3 = 0x11;      // Modem configuration
    public static final byte CC1101_MDMCFG2 = 0x12;      // Modem configuration
    public static final byte CC1101_MDMCFG1 = 0x13;      // Modem configuration
    public static final byte CC1101_MDMCFG0 = 0x14;      // Modem configuration
    public static final byte CC1101_DEVIATN = 0x15;      // Modem deviation setting
    public static final byte CC1101_MCSM2 = 0x16;        // Main Radio Control State Machine configuration
    public static final byte CC1101_MCSM1 = 0x17;        // Main Radio Control State Machine configuration
    public static final byte CC1101_MCSM0 = 0x18;        // Main Radio Control State Machine configuration
    public static final byte CC1101_FOCCFG = 0x19;       // Frequency Offset Compensation configuration
    public static final byte CC1101_BSCFG = 0x1A;        // Bit Synchronization configuration
    public static final byte CC1101_AGCCTRL2 = 0x1B;     // AGC control
    public static final byte CC1101_AGCCTRL1 = 0x1C;     // AGC control
    public static final byte CC1101_AGCCTRL0 = 0x1D;     // AGC control
    public static final byte CC1101_WOREVT1 = 0x1E;      // High INT8U Event 0 timeout
    public static final byte CC1101_WOREVT0 = 0x1F;      // Low INT8U Event 0 timeout
    public static final byte CC1101_WORCTRL = 0x20;      // Wake On Radio control
    public static final byte CC1101_FREND1 = 0x21;       // Front end RX configuration
    public static final byte CC1101_FREND0 = 0x22;       // Front end TX configuration
    public static final byte CC1101_FSCAL3 = 0x23;       // Frequency synthesizer calibration
    public static final byte CC1101_FSCAL2 = 0x24;       // Frequency synthesizer calibration
    public static final byte CC1101_FSCAL1 = 0x25;       // Frequency synthesizer calibration
    public static final byte CC1101_FSCAL0 = 0x26;       // Frequency synthesizer calibration
    public static final byte CC1101_RCCTRL1 = 0x27;      // RC oscillator configuration
    public static final byte CC1101_RCCTRL0 = 0x28;      // RC oscillator configuration
    public static final byte CC1101_FSTEST = 0x29;       // Frequency synthesizer calibration control
    public static final byte CC1101_PTEST = 0x2A;        // Production test
    public static final byte CC1101_AGCTEST = 0x2B;      // AGC test
    public static final byte CC1101_TEST2 = 0x2C;        // Various test settings
    public static final byte CC1101_TEST1 = 0x2D;        // Various test settings
    public static final byte CC1101_TEST0 = 0x2E;        // Various test settings

    // CC1101 Strobe commands
    public static final byte CC1101_SRES = 0x30;         // Reset chip.
    public static final byte CC1101_SFSTXON = 0x31;      // Enable and calibrate frequency synthesizer (if MCSM0.FS_AUTOCAL=1).
    // If in RX/TX: Go to a wait state where only the synthesizer is
    // running (for quick RX / TX turnaround).
    public static final byte CC1101_SXOFF = 0x32;        // Turn off crystal oscillator.
    public static final byte CC1101_SCAL = 0x33;         // Calibrate frequency synthesizer and turn it off
    // (enables quick start).
    public static final byte CC1101_SRX = 0x34;          // Enable RX. Perform calibration first if coming from IDLE and
    // MCSM0.FS_AUTOCAL=1.
    public static final byte CC1101_STX = 0x35;          // In IDLE state: Enable TX. Perform calibration first if
    // MCSM0.FS_AUTOCAL=1. If in RX state and CCA is enabled:
    // Only go to TX if channel is clear.
    public static final byte CC1101_SIDLE = 0x36;        // Exit RX / TX, turn off frequency synthesizer and exit
    // Wake-On-Radio mode if applicable.
    public static final byte CC1101_SAFC = 0x37;         // Perform AFC adjustment of the frequency synthesizer
    public static final byte CC1101_SWOR = 0x38;         // Start automatic RX polling sequence (Wake-on-Radio)
    public static final byte CC1101_SPWD = 0x39;         // Enter power down mode when CSn goes high.
    public static final byte CC1101_SFRX = 0x3A;         // Flush the RX FIFO buffer.
    public static final byte CC1101_SFTX = 0x3B;         // Flush the TX FIFO buffer.
    public static final byte CC1101_SWORRST = 0x3C;      // Reset real time clock.
    public static final byte CC1101_SNOP = 0x3D;         // No operation. May be used to pad strobe commands to two
    // INT8Us for simpler software.

    // CC1101 Status Registers
    public static final byte CC1101_PARTNUM = 0x30;      // Part number
    public static final byte CC1101_VERSION = 0x31;      // Version number
    public static final byte CC1101_FREQEST = 0x32;      // Frequency estimate
    public static final byte CC1101_LQI = 0x33;          // Link quality indicator
    public static final byte CC1101_RSSI = 0x34;         // Received signal strength indicator
    public static final byte CC1101_MARCSTATE = 0x35;    // Main Radio Control State Machine state
    public static final byte CC1101_WORTIME1 = 0x36;     // High byte of WOR timer
    public static final byte CC1101_WORTIME0 = 0x37;     // Low byte of WOR timer
    public static final byte CC1101_PKTSTATUS = 0x38;    // Current GDOx status and packet status
    public static final byte CC1101_VCO_VC_DAC = 0x39;   // Current setting from PLL calibration module
    public static final byte CC1101_TXBYTES = 0x3A;      // Underflow and number of bytes in the TX FIFO
    public static final byte CC1101_RXBYTES = 0x3B;

    //CC1101 PATABLE,TXFIFO,RXFIFO
    public static final byte CC1101_PATABLE = 0x3E;
    public static final byte CC1101_TXFIFO = 0x3F;
    public static final byte CC1101_RXFIFO = 0x3F;

    //MODULATIONS
    public static final byte MOD_2FSK = 0;
    public static final byte MOD_GFSK = 1;
    public static final byte MOD_ASK = 3;
    public static final byte MOD_4FSK = 4;
    public static final byte MOD_MSK = 7;

    public static final byte WRITE_BURST = (byte)0x40;
    public static final byte READ_SINGLE = (byte)0x80;
    public static final byte READ_BURST = (byte)0xC0;
    public static final byte BYTES_IN_RXFIFO = 0x7F;            //byte number in RXfifo mask


    public CC1101(CommandSender commandSender) {
        this.commandSender = commandSender;
    }

    public boolean isConnected() {
        byte[] resp = sendCommandString("ble?", 250);
        return resp != null && resp.length > 0;
    }

    private byte[] sendCommandString(String command, long timeoutMs) {
        if (commandSender == null) {
            return null;
        }
        String framed = command != null ? command : "";
        if (!framed.endsWith("\n")) {
            framed += "\n";
        }
        return commandSender.sendCommandAndGetResponse(
                framed.getBytes(StandardCharsets.UTF_8),
                0,
                0,
                timeoutMs
        );
    }

    private static boolean isAckOk(byte[] response) {
        return response != null && response.length == 1 && (response[0] & 0xFF) == 0x00;
    }


    public void spiStrobe(byte commandStrobe) {
        sendCommandString(String.format("cc1101 strobe --cmd=0x%02X", commandStrobe & 0xFF), 1000);
    }

    public void writeBurstReg(byte addr, byte[] data, byte len){
        if (data == null || data.length == 0) {
            return;
        }
        StringBuilder hex = new StringBuilder();
        for (int i = 0; i < data.length; i++) {
            if (i > 0) {
                hex.append(',');
            }
            hex.append(String.format("0x%02X", data[i] & 0xFF));
        }
        sendCommandString(
                String.format("cc1101 write_burst --reg=0x%02X --data=%s", addr & 0xFF, hex),
                1000
        );
    }

    public byte [] readBurstReg(byte addr, int len){
        if (len <= 0) {
            return new byte[0];
        }
        byte[] response = sendCommandString(
                String.format("cc1101 read_burst --reg=0x%02X --len=%d", addr & 0xFF, len),
                1000
        );
        if (response == null || response.length != len) {
            return null;
        }
        Log.i("readBurstReg", toHexStringWithHexPrefix(response));
        return response;
    }

    public byte readReg(byte addr){
        byte[] response = sendCommandString(
                String.format("cc1101 read --reg=0x%02X", addr & 0xFF),
                1000
        );
        if (response == null || response.length < 1) {
            return 0;
        }
        Log.i("readReg", toHexStringWithHexPrefix(response));
        return response[0];
    }

    public void writeReg(byte addr, byte data){
        byte[] response = sendCommandString(
                String.format("cc1101 write --reg=0x%02X --val=0x%02X", addr & 0xFF, data & 0xFF),
                1000
        );
        Log.i("writeReg", Arrays.toString(response));
    }


    public void sendData(byte [] txBuffer, int size, int t) {
        writeBurstReg(CC1101_TXFIFO, txBuffer, (byte) size);     //write data to send
        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_STX);                          //start send
        try {
            Thread.sleep(t);                                //wait for transmission to be done
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        spiStrobe(CC1101_SFTX);                         //flush TXfifo
    }

    public byte [] receiveData() {
        byte size_reading;
        byte [] rxBuffer;
        size_reading = readReg((byte)(CC1101_RXBYTES | READ_BURST));

        if((size_reading & BYTES_IN_RXFIFO) > 0) {
            rxBuffer = readBurstReg(CC1101_RXFIFO, size_reading);
            spiStrobe(CC1101_SFRX);
            spiStrobe(CC1101_SRX);
            return rxBuffer;
        }
        else {
            spiStrobe(CC1101_SFRX);
            spiStrobe(CC1101_SRX);
            return null;
        }
    }



    public void sendInit(){
        sendCommandString("cc1101 init", 1500);
        sendCommandString("cc1101 apply_defaults", 1500);
        spiStrobe(CC1101_SIDLE);
        spiStrobe(CC1101_SFTX);
    }

    public void sendInitRx(){
        sendInit();
        spiStrobe(CC1101_SFRX);
        spiStrobe(CC1101_SRX);
    }

    public void sendInitRxContinuous(){
        sendInitRx();
    }

    public boolean setDataRate(int bitRate) {
        byte[] response = sendCommandString(String.format("cc1101 set_datarate --bps=%d", bitRate), 1500);
        return isAckOk(response);
    }

    public boolean setModulation(byte modulation) {
        String modStr;
        if (modulation == MOD_ASK) {
            modStr = "ask";
        } else if (modulation == MOD_2FSK) {
            modStr = "2fsk";
        } else if (modulation == MOD_GFSK) {
            modStr = "gfsk";
        } else if (modulation == MOD_4FSK) {
            modStr = "4fsk";
        } else if (modulation == MOD_MSK) {
            modStr = "msk";
        } else {
            return false;
        }
        byte[] response = sendCommandString(String.format("cc1101 set_mod --mod=%s", modStr), 1500);
        return isAckOk(response);
    }

    public String toHexStringWithHexPrefix(byte[] array) {
        StringBuilder hexString = new StringBuilder("[");
        for (int i = 0; i < array.length; i++) {
            // Convert the byte to a hex string with a leading zero, then take the last two characters
            // (in case of negative bytes, which result in longer hex strings)
            String hex = "0x" + Integer.toHexString(array[i] & 0xFF).toUpperCase();

            hexString.append(hex);

            // Append comma and space if this is not the last byte
            if (i < array.length - 1) {
                hexString.append(", ");
            }
        }
        hexString.append("]");
        return hexString.toString();
    }

    public boolean setManchesterEncoding(boolean manchester){
        byte mdmcfg2 = readReg(CC1101_MDMCFG2);
        //bit 3 is the manchester encoding bit
        if(manchester){
            mdmcfg2 |= 0b00001000;
        }
        else{
            mdmcfg2 &= 0b11110111;
        }
        writeReg(CC1101_MDMCFG2, mdmcfg2);
        //verify
        return readReg(CC1101_MDMCFG2) == mdmcfg2;
    }

    public boolean setSyncMode(byte syncmode){
        // Read the current register value
        byte currentValue = readReg(CC1101_MDMCFG2);

        Log.i("MDMCFG2", "current value: " + currentValue);

        byte mask = 0b00000111; // Mask for the sync mode bits (bit 0, 1, 2)
        currentValue &= ~mask; // Clear the sync bits

        // Set the new sync bits
        // Assuming that the 'sync' argument is already just the 3 bits needed

        currentValue |= (syncmode); // Combine the new modulation bits with the current value

        Log.i("MDMCFG2", "modified value: " + currentValue);
        // Write the new value back to the register
        writeReg(CC1101_MDMCFG2, currentValue);

        // Assuming writeReg method exists and returns a boolean indicating success
        return readReg(CC1101_MDMCFG2) == currentValue;
    }


    public boolean setDeviation(int deviation) {
        // Constants for the DEVIATN register calculation
        final double F_OSC = 26_000_000; // Oscillator frequency in Hz
        final int DEVIATION_M_MAX = 7; // 3-bit DEVIATION_M has max value 7
        final int DEVIATION_E_MAX = 7; // 3-bit DEVIATION_E has max value 7

        // The target deviation formula as per the datasheet
        double target = deviation * Math.pow(2, 17) / F_OSC;
        double minDifference = Double.MAX_VALUE;
        int bestM = 0;
        int bestE = 0;

        // Find the closest DEVIATION_M and DEVIATION_E for the desired deviation
        for (int e = 0; e <= DEVIATION_E_MAX; e++) {
            for (int m = 0; m <= DEVIATION_M_MAX; m++) {
                double currentValue = (8 + m) * Math.pow(2, e);
                double difference = Math.abs(currentValue - target);
                if (difference < minDifference) {
                    minDifference = difference;
                    bestM = m;
                    bestE = e;
                }
            }
        }

        byte [] values = {(byte)bestE, (byte)bestM};
        // Log the values found
        Log.i("Deviation", toHexStringWithHexPrefix(values));

        // Combine the read TX and RX parts with the calculated DEVIATION_E and DEVIATION_M
        int combinedValue = ((bestE << 4) & 0x70) | (bestM & 0x07);

        // Write the combined value to the DEVIATN register
        writeReg((byte) CC1101_DEVIATN, (byte) combinedValue);

        // Confirm reading
        byte confirmValue = readReg((byte)CC1101_DEVIATN);
        if (confirmValue == (byte)combinedValue) {
            return true;
        } else {
            return false;
        }
    }


    public boolean setNumPreambleBytes(int num){
        byte mdmcfg1 = (byte)(num << 4);

        writeReg(CC1101_MDMCFG1, mdmcfg1);
        //verify
        return readReg(CC1101_MDMCFG1) == mdmcfg1;
    }

    public boolean setSyncWord(byte[] syncword) {
        if (syncword == null || syncword.length != 2) {
            // Invalid input: Sync word must be exactly 2 bytes long
            return false;
        }
        // Write the sync word to the CC1101_SYNC1 address
        writeBurstReg(CC1101_SYNC1, syncword, (byte) 2);

        // Read back the sync word from the same address
        byte[] readBack = readBurstReg(CC1101_SYNC1, 2);

        // Compare the written sync word with the read back value
        return Arrays.equals(syncword, readBack);
    }

    public boolean setPktLength(int length){
        byte pktlen = (byte)length;
        writeReg(CC1101_PKTLEN, pktlen);
        //verify
        return readReg(CC1101_PKTLEN) == pktlen;
    }

    public boolean getGDO() {
        return false;
    }



    public String bytesToHexString(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xFF & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    public byte[] convertHexStringToByteArray(String hexString) {
        // Remove any non-hex characters (like spaces) if present
        hexString = hexString.replaceAll("[^0-9A-Fa-f]", "");
        Log.i("Hex Conversion", hexString);

        // Check if the string has an even number of characters
        if (hexString.length() % 2 != 0) {
            Log.e("Hex Conversion", "Invalid hex string");
            return null; // Return null or throw an exception as appropriate
        }

        byte[] bytes = new byte[hexString.length() / 2];

        StringBuilder hex_string = new StringBuilder();

        for (int i = 0; i < bytes.length; i++) {
            int index = i * 2;
            int value = Integer.parseInt(hexString.substring(index, index + 2), 16);
            bytes[i] = (byte) value;
            hex_string.append(String.format("%02X ", bytes[i]));
        }

        Log.i("Payload bytes", hex_string.toString());

        return bytes;
    }


}
