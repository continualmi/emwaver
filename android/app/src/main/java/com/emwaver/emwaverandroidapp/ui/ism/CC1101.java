package com.emwaver.emwaverandroidapp.ui.ism;

import android.util.Log;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.Utils;

import java.util.Arrays;

public class CC1101 {

    private static final String TAG = "CC1101";
    private final BLEService bleService;

    //region CC1101 REGISTERS
    // CC1101 Configuration Registers
    public static final byte IOCFG2 = 0x00;       // GDO2 output pin configuration
    public static final byte IOCFG1 = 0x01;       // GDO1 output pin configuration
    public static final byte IOCFG0 = 0x02;       // GDO0 output pin configuration
    public static final byte FIFOTHR = 0x03;      // RX FIFO and TX FIFO thresholds
    public static final byte SYNC1 = 0x04;        // Sync word, high INT8U
    public static final byte SYNC0 = 0x05;        // Sync word, low INT8U
    public static final byte PKTLEN = 0x06;       // Packet length
    public static final byte PKTCTRL1 = 0x07;     // Packet automation control
    public static final byte PKTCTRL0 = 0x08;     // Packet automation control
    public static final byte ADDR = 0x09;         // Device address
    public static final byte CHANNR = 0x0A;       // Channel number
    public static final byte FSCTRL1 = 0x0B;      // Frequency synthesizer control
    public static final byte FSCTRL0 = 0x0C;      // Frequency synthesizer control
    public static final byte FREQ2 = 0x0D;        // Frequency control word, high INT8U
    public static final byte FREQ1 = 0x0E;        // Frequency control word, middle INT8U
    public static final byte FREQ0 = 0x0F;        // Frequency control word, low INT8U
    public static final byte MDMCFG4 = 0x10;      // Modem configuration
    public static final byte MDMCFG3 = 0x11;      // Modem configuration
    public static final byte MDMCFG2 = 0x12;      // Modem configuration
    public static final byte MDMCFG1 = 0x13;      // Modem configuration
    public static final byte MDMCFG0 = 0x14;      // Modem configuration
    public static final byte DEVIATN = 0x15;      // Modem deviation setting
    public static final byte MCSM2 = 0x16;        // Main Radio Control State Machine configuration
    public static final byte MCSM1 = 0x17;        // Main Radio Control State Machine configuration
    public static final byte MCSM0 = 0x18;        // Main Radio Control State Machine configuration
    public static final byte FOCCFG = 0x19;       // Frequency Offset Compensation configuration
    public static final byte BSCFG = 0x1A;        // Bit Synchronization configuration
    public static final byte AGCCTRL2 = 0x1B;     // AGC control
    public static final byte AGCCTRL1 = 0x1C;     // AGC control
    public static final byte AGCCTRL0 = 0x1D;     // AGC control
    public static final byte WOREVT1 = 0x1E;      // High INT8U Event 0 timeout
    public static final byte WOREVT0 = 0x1F;      // Low INT8U Event 0 timeout
    public static final byte WORCTRL = 0x20;      // Wake On Radio control
    public static final byte FREND1 = 0x21;       // Front end RX configuration
    public static final byte FREND0 = 0x22;       // Front end TX configuration
    public static final byte FSCAL3 = 0x23;       // Frequency synthesizer calibration
    public static final byte FSCAL2 = 0x24;       // Frequency synthesizer calibration
    public static final byte FSCAL1 = 0x25;       // Frequency synthesizer calibration
    public static final byte FSCAL0 = 0x26;       // Frequency synthesizer calibration
    public static final byte RCCTRL1 = 0x27;      // RC oscillator configuration
    public static final byte RCCTRL0 = 0x28;      // RC oscillator configuration
    public static final byte FSTEST = 0x29;       // Frequency synthesizer calibration control
    public static final byte PTEST = 0x2A;        // Production test
    public static final byte AGCTEST = 0x2B;      // AGC test
    public static final byte TEST2 = 0x2C;        // Various test settings
    public static final byte TEST1 = 0x2D;        // Various test settings
    public static final byte TEST0 = 0x2E;        // Various test settings

    // CC1101 Strobe commands
    public static final byte SRES = 0x30;         // Reset chip.
    public static final byte SFSTXON = 0x31;      // Enable and calibrate frequency synthesizer (if MCSM0.FS_AUTOCAL=1).
    // If in RX/TX: Go to a wait state where only the synthesizer is
    // running (for quick RX / TX turnaround).
    public static final byte SXOFF = 0x32;        // Turn off crystal oscillator.
    public static final byte SCAL = 0x33;         // Calibrate frequency synthesizer and turn it off
    // (enables quick start).
    public static final byte SRX = 0x34;          // Enable RX. Perform calibration first if coming from IDLE and
    // MCSM0.FS_AUTOCAL=1.
    public static final byte STX = 0x35;          // In IDLE state: Enable TX. Perform calibration first if
    // MCSM0.FS_AUTOCAL=1. If in RX state and CCA is enabled:
    // Only go to TX if channel is clear.
    public static final byte SIDLE = 0x36;        // Exit RX / TX, turn off frequency synthesizer and exit
    // Wake-On-Radio mode if applicable.
    public static final byte SAFC = 0x37;         // Perform AFC adjustment of the frequency synthesizer
    public static final byte SWOR = 0x38;         // Start automatic RX polling sequence (Wake-on-Radio)
    public static final byte SPWD = 0x39;         // Enter power down mode when CSn goes high.
    public static final byte SFRX = 0x3A;         // Flush the RX FIFO buffer.
    public static final byte SFTX = 0x3B;         // Flush the TX FIFO buffer.
    public static final byte SWORRST = 0x3C;      // Reset real time clock.
    public static final byte SNOP = 0x3D;         // No operation. May be used to pad strobe commands to two
    // INT8Us for simpler software.

    // CC1101 Status Registers
    public static final byte PARTNUM = 0x30;      // Part number
    public static final byte VERSION = 0x31;      // Version number
    public static final byte FREQEST = 0x32;      // Frequency estimate
    public static final byte LQI = 0x33;          // Link quality indicator
    public static final byte RSSI = 0x34;         // Received signal strength indicator
    public static final byte MARCSTATE = 0x35;    // Main Radio Control State Machine state
    public static final byte WORTIME1 = 0x36;     // High byte of WOR timer
    public static final byte WORTIME0 = 0x37;     // Low byte of WOR timer
    public static final byte PKTSTATUS = 0x38;    // Current GDOx status and packet status
    public static final byte VCO_VC_DAC = 0x39;   // Current setting from PLL calibration module
    public static final byte TXBYTES = 0x3A;      // Underflow and number of bytes in the TX FIFO
    public static final byte RXBYTES = 0x3B;

    //CC1101 PATABLE,TXFIFO,RXFIFO
    public static final byte PATABLE = 0x3E;
    public static final byte TXFIFO = 0x3F;
    public static final byte RXFIFO = 0x3F;

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

    public static final int GDO_INPUT = 0;

    public static final int GDO_OUTPUT = 1;

    public static final int GDO_0 = 0;

    public static final int GDO_2 = 1;
    // Power settings for 315 MHz
    private static final byte[] POWER_SETTING_315MHZ = {
            (byte)0x12, (byte)0x0D, (byte)0x1C, (byte)0x34,
            (byte)0x51, (byte)0x85, (byte)0xCB, (byte)0xC2
    };
    // Power settings for 433 MHz
    private static final byte[] POWER_SETTING_433MHZ = {
            (byte)0x12, (byte)0x0E, (byte)0x1D, (byte)0x34,
            (byte)0x60, (byte)0x84, (byte)0xC8, (byte)0xC0
    };
    // Power settings for 868 MHz
    private static final byte[] POWER_SETTING_868MHZ = {
            (byte)0x03, (byte)0x0F, (byte)0x1E, (byte)0x27,
            (byte)0x50, (byte)0x81, (byte)0xCB, (byte)0xC2
    };
    // Power settings for 915 MHz (assuming similar to 868 MHz due to proximity)
    private static final byte[] POWER_SETTING_915MHZ = {
            (byte)0x03, (byte)0x0E, (byte)0x1E, (byte)0x27,
            (byte)0x8E, (byte)0xCD, (byte)0xC7, (byte)0xC0
    };
    public static final int[] POWER_LEVELS = {-30, -20, -15, -10, 0, 5, 7, 10};
    //endregion
    
    public CC1101(BLEService bleService) {
        this.bleService = bleService;
    }

    //region SPI functions
    public void spiStrobe(byte commandStrobe) {
        byte[] command = new byte[15]; // Increased size to accommodate new format
        byte[] response;
        
        // Format: "cc1101 strobe X" where X is the commandStrobe byte
        String cmdStr = "cc1101 strobe " + (char)commandStrobe;
        System.arraycopy(cmdStr.getBytes(), 0, command, 0, cmdStr.length());
        
        response = bleService.sendCommand(command, 1000);
        Log.i("spiStrobe", Utils.toHexStringWithHexPrefix(response));  //response is the status byte
    }
    
    public void writeBurstReg(byte addr, byte[] data, byte len){
        byte[] command = new byte[data.length + 20]; // Increased size to accommodate new format
        byte[] response;
        
        // Format: "cc1101 burstwrite X Y data..." where X is addr, Y is len
        String cmdPrefix = "cc1101 burstwrite ";
        System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
        command[cmdPrefix.length()] = addr;
        command[cmdPrefix.length() + 1] = len;
        System.arraycopy(data, 0, command, cmdPrefix.length() + 2, data.length);
        
        response = bleService.sendCommand(command, 1000);
        Log.i("writeBurstReg", Utils.toHexStringWithHexPrefix(response)); //response is the status byte
    }
    
    public byte[] readBurstReg(byte addr, int len){
        byte[] command = new byte[20]; // Increased size to accommodate new format
        byte[] response;
        
        // Format: "cc1101 burstread X Y" where X is addr, Y is len
        String cmdPrefix = "cc1101 burstread ";
        System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
        command[cmdPrefix.length()] = addr;
        command[cmdPrefix.length() + 1] = (byte)len;
        
        response = bleService.sendCommand(command, 1000);
        Log.i("readBurstReg", Utils.toHexStringWithHexPrefix(response));
        return response;
    }
    
    public byte readReg(byte addr){
        long startTime = System.currentTimeMillis();
        
        byte[] command = new byte[20]; // Increased size to accommodate new format
        
        // Format: "cc1101 readreg X" where X is addr
        String cmdPrefix = "cc1101 readreg ";
        System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
        command[cmdPrefix.length()] = addr;
        
        byte[] response = bleService.sendCommand(command, 1000);
        
        long endTime = System.currentTimeMillis();
        long elapsedTime = endTime - startTime;
        Log.i(TAG, "Register read (addr: 0x" + String.format("%02X", addr) + ") took " + elapsedTime + "ms");
        
        if (response != null && response.length > 0) {
            return response[0];
        } else {
            Log.e(TAG, "Failed to read register: " + addr);
            return 0;
        }
    }
    
    public void writeReg(byte addr, byte data){
        long startTime = System.currentTimeMillis();
        
        byte[] command = new byte[20]; // Increased size to accommodate new format
        
        // Format: "cc1101 writereg X Y" where X is addr, Y is data
        String cmdPrefix = "cc1101 writereg ";
        System.arraycopy(cmdPrefix.getBytes(), 0, command, 0, cmdPrefix.length());
        command[cmdPrefix.length()] = addr;
        command[cmdPrefix.length() + 1] = data;
        
        bleService.sendCommand(command, 1000);
        
        long endTime = System.currentTimeMillis();
        long elapsedTime = endTime - startTime;
        Log.i(TAG, "Register write (addr: 0x" + String.format("%02X", addr) + ", value: 0x" + 
              String.format("%02X", data) + ") took " + elapsedTime + "ms");
    }
    
    public void sendData(byte [] txBuffer, int size, int t) {
        writeBurstReg(TXFIFO, txBuffer, (byte) size);     //write data to send
        spiStrobe(SIDLE);
        spiStrobe(STX);                          //start send
        try {
            Thread.sleep(t);                                //wait for transmission to be done
        } catch (InterruptedException e) {
            throw new RuntimeException(e);
        }
        spiStrobe(SFTX);                         //flush TXfifo
    }
    public byte [] receiveData() {
        byte size_reading;
        byte [] rxBuffer;
        size_reading = readReg((byte)(RXBYTES | READ_BURST));

        if((size_reading & BYTES_IN_RXFIFO) > 0) {
            rxBuffer = readBurstReg(RXFIFO, size_reading);
            spiStrobe(SFRX);
            spiStrobe(SRX);
            return rxBuffer;
        }
        else {
            spiStrobe(SFRX);
            spiStrobe(SRX);
            return null;
        }
    }

    public boolean setDataRate(int bitRate) {
        // Constants for the DRATE register calculation
        final double F_OSC = 26_000_000; // Oscillator frequency in Hz
        final int DRATE_M_MAX = 255; // 8-bit DRATE_M has max value 255
        final int DRATE_E_MAX = 15;  // 4-bit DRATE_E has max value 15
        double target = bitRate * Math.pow(2, 28) / F_OSC;
        double minDifference = Double.MAX_VALUE;
        int bestM = 0;
        int bestE = 0;

        // Find the closest DRATE_M and DRATE_E for the desired bit rate
        for (int e = 0; e <= DRATE_E_MAX; e++) {
            for (int m = 0; m <= DRATE_M_MAX; m++) {
                double currentValue = (256 + m) * Math.pow(2, e);
                double difference = Math.abs(currentValue - target);
                if (difference < minDifference) {
                    minDifference = difference;
                    bestM = m;
                    bestE = e;
                }
            }
        }

        byte [] values= {(byte)bestE, (byte)bestM};
        // Log the values found
        Log.i("DataRate", Utils.toHexStringWithHexPrefix(values));

        // Read the current value of the MDMCFG4 register to keep the first word
        byte readValue = readReg(MDMCFG4);
        int bandwidthPart = readValue & 0xF0; // Ensure it is treated as unsigned

        // Combine the read first word with the calculated DRATE_M
        int combinedE = bandwidthPart | (bestE & 0x0F); // Assumes the first word is the high byte

        // Write the combined value and DRATE_E to the modem configuration registers
        byte[] mdmcfg = {(byte) combinedE, (byte) bestM};
        writeBurstReg((byte) MDMCFG4, mdmcfg, (byte) 2);


        //confirm reading
        byte [] confirmValue = readBurstReg((byte)MDMCFG4, 2);
        //Log.i("ModemConfig", "MDMCFG4: " + (int)readValue[0] + ", MDMCFG3: " + (int)readValue[1]);
        if(Arrays.equals(confirmValue, mdmcfg)){
            return true;
        }
        else{
            return false;
        }
    }
    public int getDataRate() {
        // Constants for the DRATE register calculation
        final double F_OSC = 26_000_000; // Oscillator frequency in Hz

        // Read the DRATE_E from the MDMCFG4 register's lower nibble
        byte mdmcfg4Value = readReg(MDMCFG4);
        int drateE = mdmcfg4Value & 0x0F;

        // Read the DRATE_M from the MDMCFG3 register
        byte mdmcfg3Value = readReg(MDMCFG3);
        int drateM = mdmcfg3Value & 0xFF;

        // Calculate the bit rate using the formula
        double bitRate = ((256 + drateM) * Math.pow(2, drateE) * F_OSC) / Math.pow(2, 28);

        return (int) Math.round(bitRate);
    }
    //endregion


    //region Frequency
    public void setFrequency(byte freq2, byte freq1, byte freq0){
        writeReg(FREQ2, freq2);
        writeReg(FREQ1, freq1);
        writeReg(FREQ0, freq0);
    }
    public boolean setFrequencyMHz(double frequencyMHz) {
        // Assuming the oscillator frequency is 26 MHz
        double fOsc = 26e6; // 26 MHz

        // Calculate the integer representation of the frequency for CC1101 registers
        long frequency = (long) Math.round(frequencyMHz * 1e6 * Math.pow(2, 16) / fOsc);

        // Extract the individual frequency bytes
        byte freq2 = (byte) ((frequency >> 16) & 0xFF);
        byte freq1 = (byte) ((frequency >> 8) & 0xFF);
        byte freq0 = (byte) (frequency & 0xFF);

        // Set the frequency using your existing function
        setFrequency(freq2, freq1, freq0);

        calibrate();

        // Verify if the frequency was set correctly
        return Math.abs(getFrequency() - frequencyMHz) < 0.001; // Allow for small rounding errors
    }
    public double getFrequency(){
        int freq2 = readReg(FREQ2) & 0xFF;
        int freq1 = readReg(FREQ1) & 0xFF;
        int freq0 = readReg(FREQ0) & 0xFF;

        // Convert the frequency bytes to a single integer
        long frequency = ((freq2 << 16) | (freq1 << 8) | freq0);
        // Assuming the oscillator frequency is 26 MHz
        double fOsc = 26e6; // 26 MHz
        double frequencyMHz = frequency * (fOsc / Math.pow(2, 16)) / 1e6; // Convert to MHz
        Log.i("frequencyMHz", ""+frequencyMHz);
        return frequencyMHz;
    }
    //endregion

    //region Modulation
    public boolean setModulation(byte modulation) {
        // Read the current register value
        byte currentValue = readReg(MDMCFG2);

        Log.i("MDMCFG2", "current value: " + currentValue);

        byte mask = 0b01110000; // Mask for the modulation bits (bit 4, 5, 6)
        currentValue &= ~mask; // Clear the modulation bits

        // Set the new modulation bits
        // Assuming that the 'modulation' argument is already just the 3 bits needed
        // If not, it would need to be shifted into place with something like (modulation << 4)
        currentValue |= (modulation << 4); // Combine the new modulation bits with the current value

        Log.i("MDMCFG2", "modified value: " + currentValue);
        // Write the new value back to the register
        writeReg(MDMCFG2, currentValue);

        // Assuming writeReg method exists and returns a boolean indicating success
        return readReg(MDMCFG2) == currentValue;
    }
    public int getModulation(){
        int mdmcfg2 = readReg(MDMCFG2) & 0xFF; // Replace 10 with the actual index of MDMCFG2 in registerPacket
        int modulationSetting = (mdmcfg2 >> 4) & 0x07; // Shift right by 4 bits and mask out everything but bits 6:4
        Log.i("modulationSetting", ""+modulationSetting);
        return modulationSetting;
    }
    //endregion

    //region Power
    public boolean setPowerLevel(int powerLevel) {
        double frequencyMHz = getFrequency(); // Get the current frequency in MHz
        byte[] powerSettings;

        // Adjusted frequency range checks
        if (frequencyMHz >= 300 && frequencyMHz <= 348) {
            powerSettings = POWER_SETTING_315MHZ;
        } else if (frequencyMHz >= 387 && frequencyMHz <= 464) {
            powerSettings = POWER_SETTING_433MHZ;
        } else if (frequencyMHz >= 779 && frequencyMHz <= 928) {
            powerSettings = POWER_SETTING_868MHZ; // Assuming a combined setting for 868 and 915 MHz
        } else {
            return false; // Invalid frequency
        }

        // Find the index of the power level in the POWER_LEVELS array
        int index = Arrays.binarySearch(POWER_LEVELS, powerLevel);
        if (index < 0 || index >= powerSettings.length) {
            return false; // Invalid power level
        }

        // Write the power setting to the PA_TABLE
        byte powerSetting = powerSettings[index];
        writeReg(PATABLE, powerSetting);
        // Verify that the write was successful
        byte readBack = readReg(PATABLE);
        return powerSetting == readBack;
    }

    public int getPowerLevel() {
        double frequencyMHz = getFrequency(); // Get the current frequency in MHz
        byte[] powerSettings;

        // Adjusted frequency range checks
        if (frequencyMHz >= 300 && frequencyMHz <= 348) {
            powerSettings = POWER_SETTING_315MHZ;
        } else if (frequencyMHz >= 387 && frequencyMHz <= 464) {
            powerSettings = POWER_SETTING_433MHZ;
        } else if (frequencyMHz >= 779 && frequencyMHz <= 928) {
            powerSettings = POWER_SETTING_868MHZ; // Assuming a combined setting for 868 and 915 MHz
        } else {
            return Integer.MIN_VALUE; // Invalid frequency
        }

        // Read the current modulation to determine which PATABLE entry to use
        int modulation = getModulation();
        
        // Read the PATABLE entries
        byte[] paTable = readBurstReg(PATABLE, 2); // Read first two entries
        
        // Select the correct entry based on modulation
        byte currentSetting;
        if (modulation == MOD_ASK) {
            currentSetting = paTable[1]; // For ASK, use second entry
        } else {
            currentSetting = paTable[0]; // For other modulations, use first entry
        }
        
        Log.i("currentSetting", String.format("0x%02X", currentSetting & 0xFF));

        // Convert current setting to unsigned int for comparison
        int currentUnsigned = currentSetting & 0xFF;

        // Find the exact match for the currentSetting in the powerSettings array
        for (int i = 0; i < powerSettings.length; i++) {
            if ((powerSettings[i] & 0xFF) == currentUnsigned) {
                return POWER_LEVELS[i];
            }
        }

        // If no exact match, find the closest match
        int closestIndex = -1;
        int smallestDifference = Integer.MAX_VALUE;
        for (int i = 0; i < powerSettings.length; i++) {
            int settingUnsigned = powerSettings[i] & 0xFF;
            int difference = Math.abs(settingUnsigned - currentUnsigned);
            if (difference < smallestDifference) {
                smallestDifference = difference;
                closestIndex = i;
            }
        }

        // If a closest match is found, return the corresponding power level in dBm
        if (closestIndex != -1) {
            return POWER_LEVELS[closestIndex];
        } else {
            return Integer.MIN_VALUE; // If not found
        }
    }


    //endregion

    //region Bandwidth
    public boolean setBandwidth(double bandwidth) {
        // Constants for the register calculation
        final double F_XTAL = 26_000_000.0; // Crystal frequency in Hz
        final double F_IF = 100_000.0; // Intermediate frequency in Hz
        final double f_bw = bandwidth * 1e3; // Convert bandwidth to Hz

        // Calculate the bandwidth exponent (bw_exp)
        int bw_exp = 0;
        while (bw_exp <= 15 && (F_XTAL / (8 * (bw_exp + 2) * F_IF)) >= f_bw) {
            bw_exp++;
        }

        if (bw_exp > 15) {
            // Bandwidth is too low for this radio configuration
            return false;
        }

        // Calculate the bandwidth mantissa (bw_mant)
        double bw_mant = (F_XTAL / (8 * (bw_exp + 2) * F_IF)) / f_bw;
        int bw_mant_int = (int) bw_mant;
        if (bw_mant_int % 2 != 0) {
            // Round up to the nearest even number
            bw_mant_int++;
        }

        // Combine bw_exp and bw_mant to form the register value
        byte combinedValue = (byte) ((bw_exp << 4) | (bw_mant_int & 0x0F));

        // Write the combined value to the appropriate register
        writeReg((byte) MDMCFG4, combinedValue);

        // Verify the write operation
        byte confirmValue = readReg((byte) MDMCFG4);
        return confirmValue == combinedValue;
    }
    public double getBandwidth() {
        // Constants for the register calculation
        final double F_XTAL = 26_000_000.0; // Crystal frequency in Hz

        // Read the value from the MDMCFG4 register
        byte registerValue = readReg((byte) MDMCFG4);

        // Extract the bandwidth exponent (CHANBW_E) and mantissa (CHANBW_M) from the register value
        int bw_exp = (registerValue >> 6) & 0x03; // CHANBW_E: bits 7-6
        int bw_mant = (registerValue >> 4) & 0x03; // CHANBW_M: bits 5-4

        // Calculate the bandwidth in Hz using the correct formula
        double bandwidthHz = F_XTAL / (8.0 * (4.0 + bw_mant) * Math.pow(2.0, bw_exp));

        // Convert the bandwidth to kHz
        double bandwidthkHz = bandwidthHz / 1000.0;

        return bandwidthkHz;
    }




    public boolean setDeviation(int deviation) {
        // Calculate the DEVIATION value based on the formula in the datasheet
        int deviatnM = (deviation * 1000000 / (26_000_000 / 2)) / 8 - 1;
        int deviatnE = 0;
        while (deviatnM > 7) {
            deviatnM >>= 1;
            deviatnE++;
        }
        byte deviatnValue = (byte) ((deviatnE << 4) | deviatnM);
        writeReg(DEVIATN, deviatnValue);
        return readReg(DEVIATN) == deviatnValue;
    }
    public int getDeviation() {
        // Constants for the DEVIATN register calculation
        final double F_OSC = 26_000_000; // Oscillator frequency in Hz
        final int DEVIATION_M_MAX = 7; // 3-bit DEVIATION_M has max value 7
        final int DEVIATION_E_MAX = 7; // 3-bit DEVIATION_E has max value 7

        // Read the value from the DEVIATN register
        byte deviationValue = readReg((byte)DEVIATN);

        // Extract DEVIATION_M and DEVIATION_E from the combined value
        int deviationM = deviationValue & 0x07;
        int deviationE = (deviationValue >> 4) & 0x07;

        // Calculate the deviation in Hz using the formula, ensuring the result is in Hz
        double deviationHz = ((8 + deviationM) * Math.pow(2, deviationE)) * (F_OSC / Math.pow(2, 17));

        // Return the deviation as an integer in Hz
        // Depending on your needs, you might want to round the value instead of truncating it
        return (int)Math.round(deviationHz);
    }
    //endregion

    //region Gain
    public boolean setMaxDvgaGain(byte maxDvgaGain) {
        byte MAX_DVGA_GAIN_MASK = (byte) 0xC0; // 1100 0000
        byte regValue = readReg(AGCCTRL2);
        regValue = (byte) ((regValue & ~MAX_DVGA_GAIN_MASK) | ((maxDvgaGain << 6) & MAX_DVGA_GAIN_MASK));
        writeReg(AGCCTRL2, regValue);
        return readReg(AGCCTRL2) == regValue;
    }
    public byte getMaxDvgaGain() {
        byte MAX_DVGA_GAIN_MASK = (byte) 0xC0; // 1100 0000
        byte regValue = readReg(AGCCTRL2);
        return (byte) ((regValue & MAX_DVGA_GAIN_MASK) >>> 6);
    }
    public boolean setMaxLnaGain(byte maxLnaGain) {
        byte MAX_LNA_GAIN_MASK = (byte) 0x38;  // 0011 1000
        byte regValue = readReg(AGCCTRL2);
        regValue = (byte) ((regValue & ~MAX_LNA_GAIN_MASK) | ((maxLnaGain << 3) & MAX_LNA_GAIN_MASK));
        writeReg(AGCCTRL2, regValue);
        return readReg(AGCCTRL2) == regValue;
    }
    public byte getMaxLnaGain() {
        byte MAX_LNA_GAIN_MASK = (byte) 0x38;  // 0011 1000
        byte regValue = readReg(AGCCTRL2);
        return (byte) ((regValue & MAX_LNA_GAIN_MASK) >>> 3);
    }
    public boolean setMagnTarget(double magnTargetDbm) {
        byte magnTargetBit;
        switch ((int) magnTargetDbm) {
            case 24:
                magnTargetBit = 0;
                break;
            case 27:
                magnTargetBit = 1;
                break;
            case 30:
                magnTargetBit = 2;
                break;
            case 33:
                magnTargetBit = 3;
                break;
            case 36:
                magnTargetBit = 4;
                break;
            case 38:
                magnTargetBit = 5;
                break;
            case 40:
                magnTargetBit = 6;
                break;
            case 42:
                magnTargetBit = 7;
                break;
            default:
                // Handle invalid input
                return false;
        }

        byte MAGN_TARGET_MASK = (byte) 0x07;   // 0000 0111
        byte regValue = readReg(AGCCTRL2);
        regValue = (byte) ((regValue & ~MAGN_TARGET_MASK) | magnTargetBit);
        writeReg(AGCCTRL2, regValue);
        return readReg(AGCCTRL2) == regValue;
    }
    public double getMagnTarget() {
        byte MAGN_TARGET_MASK = (byte) 0x07;   // 0000 0111
        byte regValue = readReg(AGCCTRL2);
        byte magnTargetBit = (byte) (regValue & MAGN_TARGET_MASK);

        double magnTargetDbm;
        switch (magnTargetBit) {
            case 0:
                magnTargetDbm = 24;
                break;
            case 1:
                magnTargetDbm = 27;
                break;
            case 2:
                magnTargetDbm = 30;
                break;
            case 3:
                magnTargetDbm = 33;
                break;
            case 4:
                magnTargetDbm = 36;
                break;
            case 5:
                magnTargetDbm = 38;
                break;
            case 6:
                magnTargetDbm = 40;
                break;
            case 7:
                magnTargetDbm = 42;
                break;
            default:
                // Handle invalid case, although this should not happen with the mask
                throw new IllegalStateException("Invalid magnitude target bit value");
        }

        return magnTargetDbm;
    }
    public boolean setGainDbm(double gainDbm) {
        byte maxLnaGain = 0;
        byte maxDvgaGain = 0;
        boolean matchFound = false;
        int[][] gainSettings = {
                {-90, -84, -78, -72}, // MAX_LNA_GAIN 00
                {-88, -82, -76, -70}, // MAX_LNA_GAIN 01
                {-84, -78, -72, -66}, // MAX_LNA_GAIN 10
                {-82, -76, -70, -64}, // MAX_LNA_GAIN 11
                {-80, -74, -68, -62}, // MAX_LNA_GAIN 100
                {-78, -72, -66, -60}, // MAX_LNA_GAIN 101
                {-76, -70, -64, -58}, // MAX_LNA_GAIN 110
                {-74, -68, -62, -56}  // MAX_LNA_GAIN 111
        };

        // Find the matching setting for the gain in dBm
        for (int lna = 0; lna < gainSettings.length; lna++) {
            for (int dvga = 0; dvga < gainSettings[lna].length; dvga++) {
                if (gainSettings[lna][dvga] <= gainDbm) {
                    maxLnaGain = (byte)lna;
                    maxDvgaGain = (byte)dvga;
                    matchFound = true;
                    break;
                }
            }
            if (matchFound) {
                break;
            }
        }

        if (!matchFound) {
            // No match found, possibly log this or handle the error
            return false;
        }
        // Use previously defined setters to set the gain values
        if(!setMaxLnaGain(maxLnaGain)){
            return false;
        }
        if(!setMaxDvgaGain(maxDvgaGain)){
            return false;
        }
        return true;
    }
    public double getGainDbm() {
        // Use previously defined getters to get the gain values
        byte maxLnaGain = getMaxLnaGain();
        byte maxDvgaGain = getMaxDvgaGain();
        int[][] gainSettings = {
                {-90, -84, -78, -72}, // MAX_LNA_GAIN 00
                {-88, -82, -76, -70}, // MAX_LNA_GAIN 01
                {-84, -78, -72, -66}, // MAX_LNA_GAIN 10
                {-82, -76, -70, -64}, // MAX_LNA_GAIN 11
                {-80, -74, -68, -62}, // MAX_LNA_GAIN 100
                {-78, -72, -66, -60}, // MAX_LNA_GAIN 101
                {-76, -70, -64, -58}, // MAX_LNA_GAIN 110
                {-74, -68, -62, -56}  // MAX_LNA_GAIN 111
        };

        // Look up the dBm value from the table
        return gainSettings[maxLnaGain][maxDvgaGain];
    }
    public boolean setCarrierSenseRelThr(byte carrierSenseRelThr) {
        byte CARRIER_SENSE_REL_THR_MASK = (byte) 0x30; // 0011 0000
        byte regValue = readReg(AGCCTRL1);
        // Clear the relative threshold bits and set the new value
        regValue = (byte) ((regValue & ~CARRIER_SENSE_REL_THR_MASK) | ((carrierSenseRelThr << 4) & CARRIER_SENSE_REL_THR_MASK));
        writeReg(AGCCTRL1, regValue);
        return readReg(AGCCTRL1) == regValue;
    }
    public byte getCarrierSenseRelThr() {
        byte CARRIER_SENSE_REL_THR_MASK = (byte) 0x30; // 0011 0000
        byte regValue = readReg(AGCCTRL1);
        // Isolate the relative threshold bits
        return (byte) ((regValue & CARRIER_SENSE_REL_THR_MASK) >>> 4);
    }
    public boolean setCarrierSenseAbsThr(byte carrierSenseAbsThr) {
        byte CARRIER_SENSE_ABS_THR_MASK = (byte) 0x0F; // 0000 1111
        byte regValue = readReg(AGCCTRL1);
        // Clear the absolute threshold bits and set the new value
        regValue = (byte) ((regValue & ~CARRIER_SENSE_ABS_THR_MASK) | (carrierSenseAbsThr & CARRIER_SENSE_ABS_THR_MASK));
        writeReg(AGCCTRL1, regValue);
        return readReg(AGCCTRL1) == regValue;
    }
    public byte getCarrierSenseAbsThr() {
        byte CARRIER_SENSE_ABS_THR_MASK = (byte) 0x0F; // 0000 1111
        byte regValue = readReg(AGCCTRL1);
        // Isolate the absolute threshold bits
        return (byte) (regValue & CARRIER_SENSE_ABS_THR_MASK);
    }
    //endregion

    //region Packet Settings
    public boolean setPacketLength(int length){
        byte pktlen = (byte)length;
        writeReg(PKTLEN, pktlen);
        //verify
        return readReg(PKTLEN) == pktlen;
    }
    public int getPacketLength(){
        return readReg(PKTLEN) & 0xFF;
    }

    public int getPacketFormat() {
        // Read the value of the PKTCTRL0 register
        byte pktctrl0Value = readReg(PKTCTRL0);

        int packetFormat = (pktctrl0Value >> 4) & 0x03;

        // Return the PKT_FORMAT value
        return packetFormat;
    }
    public boolean setPacketFormat(int format) {
        byte PKT_FORMAT_MASK = (byte) 0xCF;
        if (format < 0 || format > 3) {
            return false; // Return false if the format is out of range
        }
        byte currentRegValue = readReg(PKTCTRL0);
        currentRegValue &= PKT_FORMAT_MASK;
        byte newRegValue = (byte) (currentRegValue | (format << 4));
        writeReg(PKTCTRL0, newRegValue);
        byte verifyRegValue = readReg(PKTCTRL0);
        // Check if the written value matches the read value for the PKT_FORMAT bits
        return (verifyRegValue & ~PKT_FORMAT_MASK) == (newRegValue & ~PKT_FORMAT_MASK);
    }

    // Constants for packet format modes
    public static final byte MODE_PACKET = 0x00;      // Normal mode, use FIFOs
    public static final byte MODE_CONTINUOUS = 0x30;  // Asynchronous serial mode (0x3 << 4)

    public boolean setMode(byte mode) {
        if (mode != MODE_PACKET && mode != MODE_CONTINUOUS) {
            return false;  // Invalid mode
        }

        // Read current register value to preserve other bits
        byte currentValue = readReg(PKTCTRL0);
        // Clear bits 5:4 (PKT_FORMAT) and set new mode
        byte newValue = (byte)((currentValue & 0xCF) | mode);

        // Write new value
        writeReg(PKTCTRL0, newValue);

        // Verify write was successful
        return readReg(PKTCTRL0) == newValue;
    }

    // Sync Mode Constants
    public static final byte SYNC_MODE_NONE = 0x00;             // No preamble/sync
    public static final byte SYNC_MODE_15_16 = 0x01;           // 15/16 sync word bits detected
    public static final byte SYNC_MODE_16_16 = 0x02;           // 16/16 sync word bits detected
    public static final byte SYNC_MODE_30_32 = 0x03;           // 30/32 sync word bits detected
    public static final byte SYNC_MODE_NONE_CS = 0x04;         // No preamble/sync, carrier-sense above threshold
    public static final byte SYNC_MODE_15_16_CS = 0x05;        // 15/16 + carrier-sense above threshold
    public static final byte SYNC_MODE_16_16_CS = 0x06;        // 16/16 + carrier-sense above threshold
    public static final byte SYNC_MODE_30_32_CS = 0x07;        // 30/32 + carrier-sense above threshold

    public boolean setSyncMode(byte syncMode) {
        // Validate sync mode
        if (syncMode > SYNC_MODE_30_32_CS) {
            return false;
        }

        // Read current MDMCFG2 value to preserve other bits
        byte currentValue = readReg(MDMCFG2);
        // Clear bits 2:0 (SYNC_MODE) and set new mode
        byte newValue = (byte)((currentValue & 0xF8) | syncMode);
        
        // Write new value
        writeReg(MDMCFG2, newValue);
        
        // Verify write was successful
        return readReg(MDMCFG2) == newValue;
    }
    public byte getSyncMode() {
        // Read the current register value
        byte currentValue = readReg(MDMCFG2);

        // Log the current value if needed
        // Log.i("MDMCFG2", "current value: " + currentValue);

        byte mask = 0b00000111; // Mask for the sync mode bits (bit 0, 1, 2)
        byte syncMode = (byte) (currentValue & mask); // Isolate the sync mode bits

        return syncMode;
    }

    public boolean setPreambleLength(int numBytes) {
        // Map the number of preamble bytes to the corresponding setting value
        int setting;
        switch (numBytes) {
            case 2:
                setting = 0;
                break;
            case 3:
                setting = 1;
                break;
            case 4:
                setting = 2;
                break;
            case 6:
                setting = 3;
                break;
            case 8:
                setting = 4;
                break;
            case 12:
                setting = 5;
                break;
            case 16:
                setting = 6;
                break;
            case 24:
                setting = 7;
                break;
            default:
                return false; // Invalid number of preamble bytes
        }
        // Shift the setting into the correct position (bits 6:4)
        byte mdmcfg1Value = (byte) (setting << 4);
        // Write the value to the register
        writeReg(MDMCFG1, mdmcfg1Value);
        // Verify that the register was set correctly
        return (readReg(MDMCFG1) & 0x70) == mdmcfg1Value;
    }
    public int getPreambleLength() {
        // Read the register value
        byte mdmcfg1Value = readReg(MDMCFG1);

        // Isolate the preamble setting bits (bits 6:4) and shift them to the LSB
        int setting = (mdmcfg1Value & 0x70) >> 4;

        // Map the setting value back to the number of preamble bytes
        switch (setting) {
            case 0:
                return 2;
            case 1:
                return 3;
            case 2:
                return 4;
            case 3:
                return 6;
            case 4:
                return 8;
            case 5:
                return 12;
            case 6:
                return 16;
            case 7:
                return 24;
            default:
                return -1; // Indicate an error if the setting is out of range
        }
    }

    public boolean setSyncWord(byte[] syncword) {
        if (syncword == null || syncword.length != 2) {
            // Invalid input: Sync word must be exactly 2 bytes long
            return false;
        }
        // Write the sync word to the SYNC1 address
        writeBurstReg(SYNC1, syncword, (byte) 2);

        // Read back the sync word from the same address
        byte[] readBack = readBurstReg(SYNC1, 2);

        // Compare the written sync word with the read back value
        return Arrays.equals(syncword, readBack);
    }
    public byte[] getSyncWord() {
        // Read the sync word from the SYNC1 and SYNC0 addresses
        return readBurstReg(SYNC1, (byte) 2);
    }

    public boolean setManchesterEncoding(boolean manchester){
        byte mdmcfg2 = readReg(MDMCFG2);
        //bit 3 is the manchester encoding bit
        if(manchester){
            mdmcfg2 |= 0b00001000;
        }
        else{
            mdmcfg2 &= 0b11110111;
        }
        writeReg(MDMCFG2, mdmcfg2);
        //verify
        return readReg(MDMCFG2) == mdmcfg2;
    }
    public boolean getManchesterEncoding() {
        byte mdmcfg2 = readReg(MDMCFG2);
        // Bit 3 is the Manchester encoding bit, mask it with 0b00001000
        return (mdmcfg2 & 0b00001000) != 0;
    }
    //endregion

    //region GPIO
    public boolean getGDO0() {
        byte response = readReg((byte) (PKTSTATUS | READ_BURST));
        return (response & 1) == 1;
    }
    public boolean getGDO2() {
        byte response = readReg((byte) (PKTSTATUS | READ_BURST));
        return (response & 0x04) >> 2 == 1;
    }
    public void configureGDO(int gdo0, int gdoInput) {
        byte[] command = {'p', 'i', 'n', (byte) gdo0, (byte) gdoInput}; // Replace with your actual command
        byte[] response = bleService.sendCommand(command, 1000);
        Log.i("configureGDO", gdo0 + ", " + Utils.bytesToHexString(response));  //response is the reading at that register
    }
    public void setGDOMode(byte gdo2, byte gdo1, byte gdo0){
        writeReg(IOCFG2, gdo2);
        writeReg(IOCFG1, gdo1);
        writeReg(IOCFG0, gdo0);
    }
    public boolean setGDO0Mode(byte gdo0){
        writeReg(IOCFG0, gdo0);
        return readReg(IOCFG0) == gdo0;
    }
    public boolean setGDO2Mode(byte gdo2){
        writeReg(IOCFG2, gdo2);
        return readReg(IOCFG2) == gdo2;
    }
    public int getGDO0Mode(){
        return readReg(IOCFG0);
    }
    public int getGDO2Mode(){
        return readReg(IOCFG2);
    }

    public boolean setFIFOThreshold(byte threshold){
        writeReg(FIFOTHR, threshold);
        return readReg(FIFOTHR) == threshold;
    }
    public int getFIFOThreshold(){
        return readReg(FIFOTHR);
    }
    //endregion


    //region Init Routines


    public void init() {
        writeReg(FSCTRL1,  (byte)0x06);

        writeReg(MDMCFG1,  (byte)0x02);
        writeReg(MDMCFG0,  (byte)0xF8);
        writeReg(CHANNR,   (byte)0x00);  // Using 0 as default channel
        writeReg(DEVIATN,  (byte)0x47);
        writeReg(FREND1,   (byte)0x56);
        writeReg(MCSM0,    (byte)0x18);
        writeReg(FOCCFG,   (byte)0x16);
        writeReg(BSCFG,    (byte)0x1C);
        writeReg(AGCCTRL2, (byte)0xC7);
        writeReg(AGCCTRL1, (byte)0x00);
        writeReg(AGCCTRL0, (byte)0xB2);
        writeReg(FSCAL3,   (byte)0xE9);
        writeReg(FSCAL2,   (byte)0x2A);
        writeReg(FSCAL1,   (byte)0x00);
        writeReg(FSCAL0,   (byte)0x1F);
        writeReg(FSTEST,   (byte)0x59);
        writeReg(TEST2,    (byte)0x81);
        writeReg(TEST1,    (byte)0x35);
        writeReg(TEST0,    (byte)0x09);
        writeReg(PKTCTRL0, (byte)0x00);
        writeReg(PKTCTRL1, (byte)0x04);
        writeReg(ADDR,     (byte)0x00);
        writeReg(PKTLEN,   (byte)0x00);
    }



    public void calibrate() {
        double freqMHz = getFrequency(); // Get current frequency setting
        
        // Calibrate based on frequency range
        if (freqMHz >= 300 && freqMHz <= 348) {
            if (freqMHz < 322.88) {
                writeReg(TEST0, (byte) 0x0B);
            } else {
                writeReg(TEST0, (byte) 0x09);
                byte fscal2 = readReg(FSCAL2);
                if ((fscal2 & 0xFF) < 32) {
                    writeReg(FSCAL2, (byte) (fscal2 + 32));
                }
            }
        } 
        else if (freqMHz >= 378 && freqMHz <= 464) {
            if (freqMHz < 430.5) {
                writeReg(TEST0, (byte) 0x0B);
            } else {
                writeReg(TEST0, (byte) 0x09);
                byte fscal2 = readReg(FSCAL2);
                if ((fscal2 & 0xFF) < 32) {
                    writeReg(FSCAL2, (byte) (fscal2 + 32));
                }
            }
        }
        else if (freqMHz >= 779 && freqMHz <= 899.99) {
            if (freqMHz < 861) {
                writeReg(TEST0, (byte) 0x0B);
            } else {
                writeReg(TEST0, (byte) 0x09);
                byte fscal2 = readReg(FSCAL2);
                if ((fscal2 & 0xFF) < 32) {
                    writeReg(FSCAL2, (byte) (fscal2 + 32));
                }
            }
        }
        else if (freqMHz >= 900 && freqMHz <= 928) {
            writeReg(TEST0, (byte) 0x09);
            byte fscal2 = readReg(FSCAL2);
            if ((fscal2 & 0xFF) < 32) {
                writeReg(FSCAL2, (byte) (fscal2 + 32));
            }
        }
    }
    //endregion

    // Define power level constants
    public static final int POWER_MINUS_30_DBM = -30;
    public static final int POWER_MINUS_20_DBM = -20;
    public static final int POWER_MINUS_15_DBM = -15;
    public static final int POWER_MINUS_10_DBM = -10;
    public static final int POWER_0_DBM = 0;
    public static final int POWER_5_DBM = 5;
    public static final int POWER_7_DBM = 7;
    public static final int POWER_10_DBM = 10;

    public boolean setModulationAndPower(byte modulation, int dbm) {
        // Get current frequency for PA table selection
        double freqMHz = getFrequency();
        byte powerSetting;
        
        // Find the exact power level match
        int powerIndex = -1;
        for (int i = 0; i < POWER_LEVELS.length; i++) {
            if (dbm == POWER_LEVELS[i]) {
                powerIndex = i;
                break;
            }
        }
        if (powerIndex == -1) {
            return false; // Invalid power level requested
        }
        
        // Select power setting based on frequency range
        if (freqMHz >= 300 && freqMHz <= 348) {
            powerSetting = POWER_SETTING_315MHZ[powerIndex];
        }
        else if (freqMHz >= 378 && freqMHz <= 464) {
            powerSetting = POWER_SETTING_433MHZ[powerIndex];
        }
        else if (freqMHz >= 779 && freqMHz <= 899.99) {
            powerSetting = POWER_SETTING_868MHZ[powerIndex];
        }
        else if (freqMHz >= 900 && freqMHz <= 928) {
            powerSetting = POWER_SETTING_915MHZ[powerIndex];
        }
        else {
            return false; // Invalid frequency
        }
        
        // Set modulation format and FREND0 register
        byte mdmcfg2Value = (byte)(modulation << 4); // Shift modulation to bits 6:4
        byte frend0Value = (modulation == MOD_ASK) ? (byte)0x11 : (byte)0x10;
        
        // Preserve other bits in MDMCFG2
        byte currentMdmcfg2 = readReg(MDMCFG2);
        mdmcfg2Value |= (currentMdmcfg2 & 0x0F); // Preserve lower 4 bits
        
        // Write the registers
        writeReg(MDMCFG2, mdmcfg2Value);
        writeReg(FREND0, frend0Value);
        
        // Set up PA table based on modulation
        byte[] paTable = new byte[8];
        if (modulation == MOD_ASK) {
            paTable[0] = 0;
            paTable[1] = powerSetting;
        } else {
            paTable[0] = powerSetting;
            paTable[1] = 0;
        }
        // Write PA table
        writeBurstReg(PATABLE, paTable, (byte) 8);
        
        // Verify the writes were successful
        return (readReg(MDMCFG2) == mdmcfg2Value) &&
               (readReg(FREND0) == frend0Value);
    }

    public void select315MHzAntenna() {
        sendGpioCommand("W", (byte) 1, "PB0");
    }

    public void select433MHzAntenna() {
        sendGpioCommand("W", (byte) 0, "PB0");
    }

    private void sendGpioCommand(String action, byte value, String pin) {
        // Assuming bleService is available and initialized
        if (bleService != null) {
            char portChar = pin.charAt(1);
            int port = (portChar == 'A') ? 0 : 1;
            int pinNumber = Integer.parseInt(pin.substring(2));

            byte[] command = new byte[]{
                    'g', 'p', 'i', 'o',
                    (byte) port,
                    (byte) pinNumber,
                    (byte) action.charAt(0),
                    value
            };

            bleService.sendCommand(command, 2000);
        }
    }

}
