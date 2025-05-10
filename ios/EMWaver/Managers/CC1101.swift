import Foundation

class CC1101 {
    // MARK: - Constants
    
    // CC1101 Configuration Registers
    static let IOCFG2: UInt8 = 0x00       // GDO2 output pin configuration
    static let IOCFG1: UInt8 = 0x01       // GDO1 output pin configuration
    static let IOCFG0: UInt8 = 0x02       // GDO0 output pin configuration
    static let FIFOTHR: UInt8 = 0x03      // RX FIFO and TX FIFO thresholds
    static let SYNC1: UInt8 = 0x04        // Sync word, high byte
    static let SYNC0: UInt8 = 0x05        // Sync word, low byte
    static let PKTLEN: UInt8 = 0x06       // Packet length
    static let PKTCTRL1: UInt8 = 0x07     // Packet automation control
    static let PKTCTRL0: UInt8 = 0x08     // Packet automation control
    static let ADDR: UInt8 = 0x09         // Device address
    static let CHANNR: UInt8 = 0x0A       // Channel number
    static let FSCTRL1: UInt8 = 0x0B      // Frequency synthesizer control
    static let FSCTRL0: UInt8 = 0x0C      // Frequency synthesizer control
    static let FREQ2: UInt8 = 0x0D        // Frequency control word, high byte
    static let FREQ1: UInt8 = 0x0E        // Frequency control word, middle byte
    static let FREQ0: UInt8 = 0x0F        // Frequency control word, low byte
    static let MDMCFG4: UInt8 = 0x10      // Modem configuration
    static let MDMCFG3: UInt8 = 0x11      // Modem configuration
    static let MDMCFG2: UInt8 = 0x12      // Modem configuration
    static let MDMCFG1: UInt8 = 0x13      // Modem configuration
    static let MDMCFG0: UInt8 = 0x14      // Modem configuration
    static let DEVIATN: UInt8 = 0x15      // Modem deviation setting
    static let MCSM2: UInt8 = 0x16        // Main Radio Control State Machine configuration
    static let MCSM1: UInt8 = 0x17        // Main Radio Control State Machine configuration
    static let MCSM0: UInt8 = 0x18        // Main Radio Control State Machine configuration
    static let FOCCFG: UInt8 = 0x19       // Frequency Offset Compensation configuration
    static let BSCFG: UInt8 = 0x1A        // Bit Synchronization configuration
    static let AGCCTRL2: UInt8 = 0x1B     // AGC control
    static let AGCCTRL1: UInt8 = 0x1C     // AGC control
    static let AGCCTRL0: UInt8 = 0x1D     // AGC control
    static let WOREVT1: UInt8 = 0x1E      // High byte Event 0 timeout
    static let WORCTRL: UInt8 = 0x20      // Wake On Radio control
    static let FREND1: UInt8 = 0x21       // Front end RX configuration
    static let FREND0: UInt8 = 0x22       // Front end TX configuration
    static let FSCAL3: UInt8 = 0x23       // Frequency synthesizer calibration
    static let FSCAL2: UInt8 = 0x24       // Frequency synthesizer calibration
    static let FSCAL1: UInt8 = 0x25       // Frequency synthesizer calibration
    static let FSCAL0: UInt8 = 0x26       // Frequency synthesizer calibration
    static let RCCTRL1: UInt8 = 0x27      // RC oscillator configuration
    static let RCCTRL0: UInt8 = 0x28      // RC oscillator configuration
    static let FSTEST: UInt8 = 0x29       // Frequency synthesizer calibration control
    static let PTEST: UInt8 = 0x2A        // Production test
    static let AGCTEST: UInt8 = 0x2B      // AGC test
    static let TEST2: UInt8 = 0x2C        // Various test settings
    static let TEST1: UInt8 = 0x2D        // Various test settings
    static let TEST0: UInt8 = 0x2E        // Various test settings
    
    // CC1101 Strobe commands
    static let SRES: UInt8 = 0x30         // Reset chip
    static let SFSTXON: UInt8 = 0x31      // Enable and calibrate frequency synthesizer
    static let SXOFF: UInt8 = 0x32        // Turn off crystal oscillator
    static let SCAL: UInt8 = 0x33         // Calibrate frequency synthesizer and turn it off
    static let SRX: UInt8 = 0x34          // Enable RX
    static let STX: UInt8 = 0x35          // Enable TX
    static let SIDLE: UInt8 = 0x36        // Exit RX / TX
    static let SAFC: UInt8 = 0x37         // Perform AFC adjustment
    static let SWOR: UInt8 = 0x38         // Start automatic RX polling sequence
    static let SPWD: UInt8 = 0x39         // Enter power down mode
    static let SFRX: UInt8 = 0x3A         // Flush the RX FIFO buffer
    static let SFTX: UInt8 = 0x3B         // Flush the TX FIFO buffer
    static let SWORRST: UInt8 = 0x3C      // Reset real time clock
    static let SNOP: UInt8 = 0x3D         // No operation
    
    // CC1101 Status Registers
    static let PARTNUM: UInt8 = 0x30      // Part number
    static let VERSION: UInt8 = 0x31      // Version number
    static let FREQEST: UInt8 = 0x32      // Frequency estimate
    static let LQI: UInt8 = 0x33          // Link quality indicator
    static let RSSI: UInt8 = 0x34         // Received signal strength indicator
    static let MARCSTATE: UInt8 = 0x35    // Main Radio Control State Machine state
    static let WORTIME1: UInt8 = 0x36     // High byte of WOR timer
    static let WORTIME0: UInt8 = 0x37     // Low byte of WOR timer
    static let PKTSTATUS: UInt8 = 0x38    // Current GDOx status and packet status
    static let VCO_VC_DAC: UInt8 = 0x39   // Current setting from PLL calibration module
    static let TXBYTES: UInt8 = 0x3A      // Underflow and number of bytes in the TX FIFO
    static let RXBYTES: UInt8 = 0x3B      // Overflow and number of bytes in the RX FIFO
    
    // CC1101 PATABLE, TXFIFO, RXFIFO
    static let PATABLE: UInt8 = 0x3E
    static let TXFIFO: UInt8 = 0x3F
    static let RXFIFO: UInt8 = 0x3F
    
    // MODULATIONS
    static let MOD_2FSK: UInt8 = 0
    static let MOD_GFSK: UInt8 = 1
    static let MOD_ASK: UInt8 = 3
    static let MOD_4FSK: UInt8 = 4
    static let MOD_MSK: UInt8 = 7
    
    // SPI Command Access Modifiers
    static let WRITE_BURST: UInt8 = 0x40
    static let READ_SINGLE: UInt8 = 0x80
    static let READ_BURST: UInt8 = 0xC0
    static let BYTES_IN_RXFIFO: UInt8 = 0x7F
    
    // GPIO Pin Configuration
    static let GDO_INPUT: Int = 0
    static let GDO_OUTPUT: Int = 1
    static let GDO_0: Int = 0
    static let GDO_2: Int = 1
    
    // Power settings for different frequency bands
    private static let POWER_SETTING_315MHZ: [UInt8] = [
        0x12, 0x0D, 0x1C, 0x34, 0x51, 0x85, 0xCB, 0xC2
    ]
    
    private static let POWER_SETTING_433MHZ: [UInt8] = [
        0x12, 0x0E, 0x1D, 0x34, 0x60, 0x84, 0xC8, 0xC0
    ]
    
    private static let POWER_SETTING_868MHZ: [UInt8] = [
        0x03, 0x0F, 0x1E, 0x27, 0x50, 0x81, 0xCB, 0xC2
    ]
    
    private static let POWER_SETTING_915MHZ: [UInt8] = [
        0x03, 0x0E, 0x1E, 0x27, 0x8E, 0xCD, 0xC7, 0xC0
    ]
    
    static let POWER_LEVELS: [Int] = [-30, -20, -15, -10, 0, 5, 7, 10]
    
    // Packet Format Modes
    static let MODE_PACKET: UInt8 = 0x00
    static let MODE_CONTINUOUS: UInt8 = 0x30
    
    // Sync modes
    static let SYNC_MODE_NONE: UInt8 = 0x00
    static let SYNC_MODE_15_16: UInt8 = 0x01
    static let SYNC_MODE_16_16: UInt8 = 0x02
    static let SYNC_MODE_30_32: UInt8 = 0x03
    static let SYNC_MODE_NONE_CS: UInt8 = 0x04
    static let SYNC_MODE_15_16_CS: UInt8 = 0x05
    static let SYNC_MODE_16_16_CS: UInt8 = 0x06
    static let SYNC_MODE_30_32_CS: UInt8 = 0x07
    
    // Power level constants
    static let POWER_MINUS_30_DBM: Int = -30
    static let POWER_MINUS_20_DBM: Int = -20
    static let POWER_MINUS_15_DBM: Int = -15
    static let POWER_MINUS_10_DBM: Int = -10
    static let POWER_0_DBM: Int = 0
    static let POWER_5_DBM: Int = 5
    static let POWER_7_DBM: Int = 7
    static let POWER_10_DBM: Int = 10
    
    // MARK: - Properties
    private let bleManager: BLEManager
    
    // MARK: - Initialization
    init(bleManager: BLEManager) {
        self.bleManager = bleManager
    }
    
    // MARK: - SPI Communication Methods
    func spiStrobe(commandStrobe: UInt8) {
        let command = "cc1101 strobe \(commandStrobe)".data(using: .utf8)!
        if let response = bleManager.sendCommand(command, timeout: 1000) {
            print("CC1101: Strobe command 0x\(String(format: "%02X", commandStrobe)) response: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
        }
    }
    
    func writeBurstReg(addr: UInt8, data: [UInt8], len: UInt8) {
        var commandString = "cc1101 burstwrite \(addr) \(len)"
        for byte in data {
            commandString += " \(byte)"
        }
        
        let command = commandString.data(using: .utf8)!
        if let response = bleManager.sendCommand(command, timeout: 1000) {
            print("CC1101: Burst write to 0x\(String(format: "%02X", addr)) response: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
        }
    }
    
    func readBurstReg(addr: UInt8, len: Int) -> [UInt8] {
        print("CC1101: Reading burst register address 0x\(String(format: "%02X", addr)) length \(len)")
        let commandString = "cc1101 burstread \(addr) \(len)"
        let command = commandString.data(using: .utf8)!
        
        if let response = bleManager.sendCommand(command, timeout: 1000) {
            print("CC1101: Burst read 0x\(String(format: "%02X", addr)) received \(response.count) bytes: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
            return [UInt8](response)
        }
        print("CC1101: Failed to read burst register 0x\(String(format: "%02X", addr))")
        return []
    }
    
    func readReg(addr: UInt8) -> UInt8 {
        print("CC1101: Reading register address 0x\(String(format: "%02X", addr))")
        let commandString = "cc1101 readreg \(addr)"
        let command = commandString.data(using: .utf8)!
        
        if let response = bleManager.sendCommand(command, timeout: 1000), !response.isEmpty {
            print("CC1101: Register 0x\(String(format: "%02X", addr)) = 0x\(String(format: "%02X", response[0]))")
            return response[0]
        }
        print("CC1101: Failed to read register 0x\(String(format: "%02X", addr))")
        return 0
    }
    
    func writeReg(addr: UInt8, value: UInt8) {
        let commandString = "cc1101 writereg \(addr) \(value)"
        let command = commandString.data(using: .utf8)!
        
        if let response = bleManager.sendCommand(command, timeout: 1000) {
            print("CC1101: Write register 0x\(String(format: "%02X", addr)) = 0x\(String(format: "%02X", value)) response: \(response.map { String(format: "%02X", $0) }.joined(separator: " "))")
        }
    }
    
    // MARK: - Data Transfer Methods
    func sendData(txBuffer: [UInt8], size: Int, t: Int) {
        writeBurstReg(addr: CC1101.TXFIFO, data: txBuffer, len: UInt8(size))
        spiStrobe(commandStrobe: CC1101.SIDLE)
        spiStrobe(commandStrobe: CC1101.STX)
        
        // Wait for transmission to complete
        Thread.sleep(forTimeInterval: Double(t) / 1000.0)
        
        spiStrobe(commandStrobe: CC1101.SFTX)
    }
    
    func receiveData() -> [UInt8]? {
        let sizeReading = readReg(addr: CC1101.RXBYTES | CC1101.READ_BURST)
        
        if ((sizeReading & CC1101.BYTES_IN_RXFIFO) > 0) {
            let rxBuffer = readBurstReg(addr: CC1101.RXFIFO, len: Int(sizeReading & CC1101.BYTES_IN_RXFIFO))
            spiStrobe(commandStrobe: CC1101.SFRX)
            spiStrobe(commandStrobe: CC1101.SRX)
            return rxBuffer
        } else {
            spiStrobe(commandStrobe: CC1101.SFRX)
            spiStrobe(commandStrobe: CC1101.SRX)
            return nil
        }
    }
    
    // MARK: - Configuration Methods
    func setDataRate(bitRate: Int) -> Bool {
        // Constants for the DRATE register calculation
        let F_OSC: Double = 26_000_000 // Oscillator frequency in Hz
        
        var drateE: Int = 0
        var drateM: Int = 0
        
        // Find suitable exponent and mantissa values
        var tempBitRate: Double = Double(bitRate)
        var diffBitRate: Double = Double.greatestFiniteMagnitude
        
        for e in 0...15 {
            let m = Int(((tempBitRate * pow(2.0, 28.0)) / (F_OSC * pow(2.0, Double(e)))) - 256.0)
            
            if m >= 0 && m <= 255 {
                let calculatedBitRate = ((256.0 + Double(m)) * pow(2.0, Double(e)) * F_OSC) / pow(2.0, 28.0)
                let diff = abs(calculatedBitRate - Double(bitRate))
                
                if diff < diffBitRate {
                    diffBitRate = diff
                    drateE = e
                    drateM = m
                }
            }
        }
        
        // Configure the registers
        let mdmcfg4Value = (readReg(addr: CC1101.MDMCFG4) & 0xF0) | UInt8(drateE)
        let mdmcfg3Value = UInt8(drateM)
        
        writeReg(addr: CC1101.MDMCFG4, value: mdmcfg4Value)
        writeReg(addr: CC1101.MDMCFG3, value: mdmcfg3Value)
        
        // Verify the write operation
        let confirmMdmcfg4 = readReg(addr: CC1101.MDMCFG4)
        let confirmMdmcfg3 = readReg(addr: CC1101.MDMCFG3)
        
        return (confirmMdmcfg4 & 0x0F) == UInt8(drateE) && confirmMdmcfg3 == UInt8(drateM)
    }
    
    func getDataRate() -> Int {
        // Constants for the DRATE register calculation
        let F_OSC: Double = 26_000_000 // Oscillator frequency in Hz
        
        // Read the DRATE_E from the MDMCFG4 register's lower nibble
        let mdmcfg4Value = readReg(addr: CC1101.MDMCFG4)
        let drateE = Int(mdmcfg4Value & 0x0F)
        
        // Read the DRATE_M from the MDMCFG3 register
        let mdmcfg3Value = readReg(addr: CC1101.MDMCFG3)
        let drateM = Int(mdmcfg3Value)
        
        // Calculate the bit rate using the formula
        // Breaking down the complex expression: ((256 + drateM) * pow(2, Double(drateE)) * F_OSC) / pow(2, 28)
        let term1 = Double(256 + drateM)
        let term2 = pow(2.0, Double(drateE))
        let term3 = term1 * term2
        let term4 = term3 * F_OSC
        let term5 = pow(2.0, 28.0)
        let bitRate = term4 / term5
        
        return Int(round(bitRate))
    }
    
    // MARK: - Frequency Methods
    func setFrequency(freq2: UInt8, freq1: UInt8, freq0: UInt8) {
        writeReg(addr: CC1101.FREQ2, value: freq2)
        writeReg(addr: CC1101.FREQ1, value: freq1)
        writeReg(addr: CC1101.FREQ0, value: freq0)
    }
    
    func setFrequencyMHz(frequencyMHz: Double) -> Bool {
        // Oscillator frequency
        let fOsc: Double = 26e6 // 26 MHz
        
        // Calculate the integer representation of the frequency
        // Break down the complex expression: Int(round(frequencyMHz * 1e6 * pow(2, 16) / fOsc))
        let term1 = frequencyMHz * 1e6
        let term2 = pow(2.0, 16.0)
        let term3 = term1 * term2
        let term4 = term3 / fOsc
        let frequency = Int(round(term4))
        
        // Extract the individual frequency bytes
        let freq2 = UInt8((frequency >> 16) & 0xFF)
        let freq1 = UInt8((frequency >> 8) & 0xFF)
        let freq0 = UInt8(frequency & 0xFF)
        
        // Set the frequency
        setFrequency(freq2: freq2, freq1: freq1, freq0: freq0)
        
        // Calibrate the radio
        calibrate()
        
        // Verify the frequency was set correctly
        return abs(getFrequency() - frequencyMHz) < 0.001
    }
    
    func getFrequency() -> Double {
        // Read the frequency control registers
        let freq2 = readReg(addr: CC1101.FREQ2)
        let freq1 = readReg(addr: CC1101.FREQ1)
        let freq0 = readReg(addr: CC1101.FREQ0)
        
        // Calculate the frequency value
        let fOsc: Double = 26e6 // 26 MHz oscillator
        
        // Break down the complex bit manipulation and conversion
        let freqReg2 = UInt(freq2) << 16
        let freqReg1 = UInt(freq1) << 8
        let freqReg0 = UInt(freq0)
        let freqRegister = freqReg2 | freqReg1 | freqReg0
        
        // Break down the formula: Double(fOsc) * Double(freqRegister) / pow(2, 16)
        let term1 = Double(freqRegister)
        let term2 = pow(2.0, 16.0)
        let term3 = term1 / term2
        let frequency = fOsc * term3
        
        return frequency / 1e6 // Return in MHz
    }
    
    // MARK: - Modulation Methods
    func setModulation(modulation: UInt8) -> Bool {
        // Read current value of MDMCFG2 register
        let currentValue = readReg(addr: CC1101.MDMCFG2)
        
        // Clear modulation bits (bits 6:4) and set new modulation
        let newValue = (currentValue & 0x8F) | (modulation << 4)
        
        // Write the new value to MDMCFG2
        writeReg(addr: CC1101.MDMCFG2, value: newValue)
        
        // Verify the write operation
        let confirmValue = readReg(addr: CC1101.MDMCFG2)
        
        return (confirmValue & 0x70) == (modulation << 4)
    }
    
    func getModulation() -> Int {
        let mdmcfg2Value = readReg(addr: CC1101.MDMCFG2)
        return Int((mdmcfg2Value & 0x70) >> 4)
    }
    
    // MARK: - Power Control Methods
    func setPowerLevel(powerLevel: Int) -> Bool {
        // Check if the power level is valid
        guard let index = CC1101.POWER_LEVELS.firstIndex(of: powerLevel) else {
            return false
        }
        
        // Get the current frequency for PA table selection
        let freqMHz = getFrequency()
        var powerSetting: UInt8
        
        // Select power setting based on frequency range
        if freqMHz >= 300 && freqMHz <= 348 {
            powerSetting = CC1101.POWER_SETTING_315MHZ[index]
        }
        else if freqMHz >= 378 && freqMHz <= 464 {
            powerSetting = CC1101.POWER_SETTING_433MHZ[index]
        }
        else if freqMHz >= 779 && freqMHz <= 899.99 {
            powerSetting = CC1101.POWER_SETTING_868MHZ[index]
        }
        else if freqMHz >= 900 && freqMHz <= 928 {
            powerSetting = CC1101.POWER_SETTING_915MHZ[index]
        }
        else {
            return false
        }
        
        // Create a PA table with the selected power level for index 1 (for both FSK and ASK)
        var paTable = [UInt8](repeating: 0, count: 8)
        paTable[1] = powerSetting
        
        // Write PA table
        writeBurstReg(addr: CC1101.PATABLE, data: paTable, len: 8)
        
        return true
    }
    
    func getPowerLevel() -> Int {
        // Read the PA table
        let paTable = readBurstReg(addr: CC1101.PATABLE, len: 8)
        guard !paTable.isEmpty else { return CC1101.POWER_LEVELS[0] }
        
        let powerSetting = paTable[1]
        let freqMHz = getFrequency()
        
        // Determine which frequency band we're in
        var powerSettingArray: [UInt8]
        
        if freqMHz >= 300 && freqMHz <= 348 {
            powerSettingArray = CC1101.POWER_SETTING_315MHZ
        }
        else if freqMHz >= 378 && freqMHz <= 464 {
            powerSettingArray = CC1101.POWER_SETTING_433MHZ
        }
        else if freqMHz >= 779 && freqMHz <= 899.99 {
            powerSettingArray = CC1101.POWER_SETTING_868MHZ
        }
        else if freqMHz >= 900 && freqMHz <= 928 {
            powerSettingArray = CC1101.POWER_SETTING_915MHZ
        }
        else {
            return CC1101.POWER_LEVELS[0]
        }
        
        // Find the closest match in power settings
        for i in 0..<powerSettingArray.count {
            if powerSettingArray[i] == powerSetting {
                return CC1101.POWER_LEVELS[i]
            }
        }
        
        // If no exact match, find the closest match
        var closestIndex = 0
        var minDifference = abs(Int(powerSettingArray[0]) - Int(powerSetting))
        
        for i in 1..<powerSettingArray.count {
            let difference = abs(Int(powerSettingArray[i]) - Int(powerSetting))
            if difference < minDifference {
                minDifference = difference
                closestIndex = i
            }
        }
        
        return CC1101.POWER_LEVELS[closestIndex]
    }
    
    // MARK: - Bandwidth Methods
    func setBandwidth(bandwidth: Double) -> Bool {
        // The CC1101 has specific bandwidth settings
        let bandwidthValues = [
            812.5, 650.0, 541.7, 464.3, 406.3, 325.0, 270.8, 232.1,
            203.1, 162.5, 135.4, 116.1, 102.0, 81.0, 68.0, 58.0
        ]
        
        // Find the closest bandwidth setting
        var closestIndex = 0
        var minDifference = abs(bandwidthValues[0] - bandwidth)
        
        for i in 1..<bandwidthValues.count {
            let difference = abs(bandwidthValues[i] - bandwidth)
            if difference < minDifference {
                minDifference = difference
                closestIndex = i
            }
        }
        
        // Extract CHANBW_E and CHANBW_M values
        let chanbwE = closestIndex / 4
        let chanbwM = closestIndex % 4
        
        // Read current MDMCFG4 value to preserve data rate exponent
        let currentMdmcfg4 = readReg(addr: CC1101.MDMCFG4)
        
        // Clear CHANBW bits and set new values
        let newMdmcfg4 = (currentMdmcfg4 & 0x0F) | (UInt8(chanbwM) << 6) | (UInt8(chanbwE) << 4)
        
        // Write new value
        writeReg(addr: CC1101.MDMCFG4, value: newMdmcfg4)
        
        // Verify
        let confirmMdmcfg4 = readReg(addr: CC1101.MDMCFG4)
        return (confirmMdmcfg4 & 0xF0) == (newMdmcfg4 & 0xF0)
    }
    
    func getBandwidth() -> Double {
        let mdmcfg4Value = readReg(addr: CC1101.MDMCFG4)
        
        // Extract CHANBW_E and CHANBW_M
        let chanbwE = (mdmcfg4Value >> 4) & 0x03
        let chanbwM = (mdmcfg4Value >> 6) & 0x03
        
        // Calculate the index into the bandwidth array
        let index = Int(chanbwE) * 4 + Int(chanbwM)
        
        // Bandwidth array in kHz
        let bandwidthValues = [
            812.5, 650.0, 541.7, 464.3, 406.3, 325.0, 270.8, 232.1,
            203.1, 162.5, 135.4, 116.1, 102.0, 81.0, 68.0, 58.0
        ]
        
        return index < bandwidthValues.count ? bandwidthValues[index] : 0.0
    }
    
    // MARK: - Deviation Methods
    func setDeviation(deviation: Int) -> Bool {
        // Calculate deviation value for register
        // Deviation = (Fosc/2^17) * (8 + DEVIATION_M) * 2^DEVIATION_E
        let fOsc: Double = 26e6
        var bestE = 0
        var bestM = 0
        var closestDeviation = 0.0
        var minDifference = Double.greatestFiniteMagnitude
        
        for e in 0...7 {
            for m in 0...7 {
                let calculatedDeviation = (fOsc / pow(2, 17)) * (8 + Double(m)) * pow(2, Double(e))
                let difference = abs(calculatedDeviation - Double(deviation))
                
                if difference < minDifference {
                    minDifference = difference
                    bestE = e
                    bestM = m
                    closestDeviation = calculatedDeviation
                }
            }
        }
        
        // Set the deviation register
        let newValue = UInt8((bestE << 4) | bestM)
        writeReg(addr: CC1101.DEVIATN, value: newValue)
        
        // Verify the write operation
        let confirmValue = readReg(addr: CC1101.DEVIATN)
        return confirmValue == newValue
    }
    
    func getDeviation() -> Int {
        let deviatnValue = readReg(addr: CC1101.DEVIATN)
        
        // Extract DEVIATION_E and DEVIATION_M
        let deviationE = (deviatnValue >> 4) & 0x07
        let deviationM = deviatnValue & 0x07
        
        // Calculate the deviation
        // Deviation = (Fosc/2^17) * (8 + DEVIATION_M) * 2^DEVIATION_E
        let fOsc: Double = 26e6
        let deviation = (fOsc / pow(2, 17)) * (8 + Double(deviationM)) * pow(2, Double(deviationE))
        
        return Int(round(deviation))
    }
    
    // MARK: - Packet Format Methods
    func setPacketLength(length: Int) -> Bool {
        let pktlen = UInt8(length)
        writeReg(addr: CC1101.PKTLEN, value: pktlen)
        
        // Verify
        return readReg(addr: CC1101.PKTLEN) == pktlen
    }
    
    func getPacketLength() -> Int {
        return Int(readReg(addr: CC1101.PKTLEN))
    }
    
    func setPacketFormat(format: Int) -> Bool {
        let PKT_FORMAT_MASK: UInt8 = 0xCF
        
        if format < 0 || format > 3 {
            return false
        }
        
        let currentRegValue = readReg(addr: CC1101.PKTCTRL0)
        let newRegValue = (currentRegValue & PKT_FORMAT_MASK) | UInt8(format << 4)
        
        writeReg(addr: CC1101.PKTCTRL0, value: newRegValue)
        
        let verifyRegValue = readReg(addr: CC1101.PKTCTRL0)
        return (verifyRegValue & ~PKT_FORMAT_MASK) == (newRegValue & ~PKT_FORMAT_MASK)
    }
    
    func getPacketFormat() -> Int {
        let pktctrl0Value = readReg(addr: CC1101.PKTCTRL0)
        return Int((pktctrl0Value >> 4) & 0x03)
    }
    
    // MARK: - Initialization and Calibration
   
    func calibrate() {
        // Put the radio into IDLE mode
        spiStrobe(commandStrobe: CC1101.SIDLE)
        
        // Perform manual calibration sequence
        
        // Calibrate frequency synthesizer and turn it off
        spiStrobe(commandStrobe: CC1101.SCAL)
        
        // Wait for calibration to complete (checking the MARCSTATE)
        var timeout = 20
        while timeout > 0 {
            let marcstate = readReg(addr: CC1101.MARCSTATE | CC1101.READ_BURST) & 0x1F
            if marcstate == 0x01 { // IDLE state
                break
            }
            usleep(10000) // 10ms delay
            timeout -= 1
        }
    }
    
    // MARK: - Combined Configuration Method
    func setModulationAndPower(modulation: UInt8, dbm: Int) -> Bool {
        // Get current frequency for PA table selection
        let freqMHz = getFrequency()
        var powerSetting: UInt8
        
        // Find the exact power level match
        guard let powerIndex = CC1101.POWER_LEVELS.firstIndex(of: dbm) else {
            return false // Invalid power level requested
        }
        
        // Select power setting based on frequency range
        if freqMHz >= 300 && freqMHz <= 348 {
            powerSetting = CC1101.POWER_SETTING_315MHZ[powerIndex]
        }
        else if freqMHz >= 378 && freqMHz <= 464 {
            powerSetting = CC1101.POWER_SETTING_433MHZ[powerIndex]
        }
        else if freqMHz >= 779 && freqMHz <= 899.99 {
            powerSetting = CC1101.POWER_SETTING_868MHZ[powerIndex]
        }
        else if freqMHz >= 900 && freqMHz <= 928 {
            powerSetting = CC1101.POWER_SETTING_915MHZ[powerIndex]
        }
        else {
            return false // Invalid frequency
        }
        
        // Set modulation format and FREND0 register
        let mdmcfg2Value = (modulation << 4) // Shift modulation to bits 6:4
        let frend0Value: UInt8 = (modulation == CC1101.MOD_ASK) ? 0x11 : 0x10
        
        // Preserve other bits in MDMCFG2
        let currentMdmcfg2 = readReg(addr: CC1101.MDMCFG2)
        let newMdmcfg2Value = (currentMdmcfg2 & 0x0F) | UInt8(mdmcfg2Value)
        
        // Write the registers
        writeReg(addr: CC1101.MDMCFG2, value: newMdmcfg2Value)
        writeReg(addr: CC1101.FREND0, value: frend0Value)
        
        // Set up PA table based on modulation
        var paTable = [UInt8](repeating: 0, count: 8)
        
        if modulation == CC1101.MOD_ASK {
            // For ASK, PA table needs values at index 0 (zero) and index 1 (max)
            paTable[0] = 0x00
            paTable[1] = powerSetting
        } else {
            // For FSK and other modulations, only set index 1
            paTable[1] = powerSetting
        }
        
        // Write PA table
        writeBurstReg(addr: CC1101.PATABLE, data: paTable, len: 8)
        
        return true
    }
    
    // MARK: - Antenna Selection Methods
    func select315MHzAntenna() {
        sendGpioCommand(action: "write", value: 1, pin: "13")
    }
    
    func select433MHzAntenna() {
        sendGpioCommand(action: "write", value: 0, pin: "13")
    }
    
    private func sendGpioCommand(action: String, value: UInt8, pin: String) {
        let commandString = "gpio\(action)\(value)\(pin)"
        if let commandData = commandString.data(using: .utf8) {
            bleManager.sendPacket(commandData)
        }
    }
    
    // MARK: - Sync Word Methods
    func setSyncWord(syncword: [UInt8]) -> Bool {
        guard syncword.count >= 2 else {
            return false
        }
        
        writeReg(addr: CC1101.SYNC1, value: syncword[0])
        writeReg(addr: CC1101.SYNC0, value: syncword[1])
        
        // Verify
        let confirmSync1 = readReg(addr: CC1101.SYNC1)
        let confirmSync0 = readReg(addr: CC1101.SYNC0)
        
        return confirmSync1 == syncword[0] && confirmSync0 == syncword[1]
    }
    
    func getSyncWord() -> [UInt8] {
        let sync1 = readReg(addr: CC1101.SYNC1)
        let sync0 = readReg(addr: CC1101.SYNC0)
        
        return [sync1, sync0]
    }
    
    // MARK: - Manchester Encoding Methods
    func setManchesterEncoding(manchester: Bool) -> Bool {
        // Read current MDMCFG2 value
        let mdmcfg2Value = readReg(addr: CC1101.MDMCFG2)
        
        // Set or clear the manchester encoding bit (bit 3)
        let newValue: UInt8
        if manchester {
            newValue = mdmcfg2Value | 0x08 // Set bit 3
        } else {
            newValue = mdmcfg2Value & ~0x08 // Clear bit 3
        }
        
        // Write the new value
        writeReg(addr: CC1101.MDMCFG2, value: newValue)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.MDMCFG2)
        return ((confirmValue & 0x08) != 0) == manchester
    }
    
    func getManchesterEncoding() -> Bool {
        let mdmcfg2Value = readReg(addr: CC1101.MDMCFG2)
        return (mdmcfg2Value & 0x08) != 0
    }
    
    // MARK: - GDO Pin Methods
    func getGDO0() -> Bool {
        // This would require reading the GPIO pin value from the ESP32
        // We would need to implement a command to read GPIO pin states
        // For now, assume a default implementation that reads via a custom command
        let command: [UInt8] = [0x67, 0x64, 0x30] // "gd0"
        bleManager.sendPacket(Data(command))
        
        if let response = bleManager.getCommand() {
            return !response.isEmpty && response[0] != 0
        }
        return false
    }
    
    func getGDO2() -> Bool {
        // Similar to getGDO0, but for GDO2
        let command: [UInt8] = [0x67, 0x64, 0x32] // "gd2"
        bleManager.sendPacket(Data(command))
        
        if let response = bleManager.getCommand() {
            return !response.isEmpty && response[0] != 0
        }
        return false
    }
    
    func configureGDO(gdo0: Int, gdoInput: Int) {
        // This would require a specific implementation based on the ESP32 firmware
        // Placeholder implementation
        print("configureGDO: Not fully implemented")
    }
    
    func setGDOMode(gdo2: UInt8, gdo1: UInt8, gdo0: UInt8) {
        writeReg(addr: CC1101.IOCFG2, value: gdo2)
        writeReg(addr: CC1101.IOCFG1, value: gdo1)
        writeReg(addr: CC1101.IOCFG0, value: gdo0)
    }
    
    func setGDO0Mode(gdo0Mode: UInt8) -> Bool {
        writeReg(addr: CC1101.IOCFG0, value: gdo0Mode)
        return readReg(addr: CC1101.IOCFG0) == gdo0Mode
    }
    
    func setGDO2Mode(gdo2Mode: UInt8) -> Bool {
        writeReg(addr: CC1101.IOCFG2, value: gdo2Mode)
        return readReg(addr: CC1101.IOCFG2) == gdo2Mode
    }
    
    func getGDO0Mode() -> Int {
        return Int(readReg(addr: CC1101.IOCFG0))
    }
    
    func getGDO2Mode() -> Int {
        return Int(readReg(addr: CC1101.IOCFG2))
    }
    
    // MARK: - FIFO Threshold Methods
    func setFIFOThreshold(threshold: UInt8) -> Bool {
        writeReg(addr: CC1101.FIFOTHR, value: threshold)
        return readReg(addr: CC1101.FIFOTHR) == threshold
    }
    
    func getFIFOThreshold() -> Int {
        return Int(readReg(addr: CC1101.FIFOTHR))
    }
    
    // MARK: - Sync Mode Methods
    func setSyncMode(syncMode: UInt8) -> Bool {
        // SYNC_MODE is in bits 2:0 of MDMCFG2
        if syncMode > 7 {
            return false // Invalid sync mode
        }
        
        let mdmcfg2Value = readReg(addr: CC1101.MDMCFG2)
        let newMdmcfg2Value = (mdmcfg2Value & 0xF8) | syncMode // Clear bits 2:0 and set new sync mode
        
        writeReg(addr: CC1101.MDMCFG2, value: newMdmcfg2Value)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.MDMCFG2)
        return (confirmValue & 0x07) == syncMode
    }
    
    func getSyncMode() -> UInt8 {
        let mdmcfg2Value = readReg(addr: CC1101.MDMCFG2)
        return mdmcfg2Value & 0x07
    }
    
    // MARK: - Preamble Length Methods
    func setPreambleLength(numBytes: Int) -> Bool {
        // The CC1101 uses a specific encoding for preamble length
        // 0 = 2 bytes
        // 1 = 3 bytes
        // 2 = 4 bytes
        // 3 = 6 bytes
        // 4 = 8 bytes
        // 5 = 12 bytes
        // 6 = 16 bytes
        // 7 = 24 bytes
        
        var preambleLengthSetting: UInt8
        
        switch numBytes {
        case 2:
            preambleLengthSetting = 0
        case 3:
            preambleLengthSetting = 1
        case 4:
            preambleLengthSetting = 2
        case 5, 6:
            preambleLengthSetting = 3 // 6 bytes
        case 7, 8:
            preambleLengthSetting = 4 // 8 bytes
        case 9, 10, 11, 12:
            preambleLengthSetting = 5 // 12 bytes
        case 13, 14, 15, 16:
            preambleLengthSetting = 6 // 16 bytes
        default:
            if numBytes <= 2 {
                preambleLengthSetting = 0 // Minimum
            } else if numBytes > 16 {
                preambleLengthSetting = 7 // Maximum (24 bytes)
            } else {
                // For other values, choose the next larger setting
                let validLengths = [2, 3, 4, 6, 8, 12, 16, 24]
                var nextLarger = 24
                
                for length in validLengths {
                    if length >= numBytes {
                        nextLarger = length
                        break
                    }
                }
                
                switch nextLarger {
                case 2: preambleLengthSetting = 0
                case 3: preambleLengthSetting = 1
                case 4: preambleLengthSetting = 2
                case 6: preambleLengthSetting = 3
                case 8: preambleLengthSetting = 4
                case 12: preambleLengthSetting = 5
                case 16: preambleLengthSetting = 6
                case 24: preambleLengthSetting = 7
                default: preambleLengthSetting = 7
                }
            }
        }
        
        // NUM_PREAMBLE is in bits 6:4 of MDMCFG1
        let mdmcfg1Value = readReg(addr: CC1101.MDMCFG1)
        let newMdmcfg1Value = (mdmcfg1Value & 0x8F) | (preambleLengthSetting << 4)
        
        writeReg(addr: CC1101.MDMCFG1, value: newMdmcfg1Value)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.MDMCFG1)
        return ((confirmValue >> 4) & 0x07) == preambleLengthSetting
    }
    
    func getPreambleLength() -> Int {
        let mdmcfg1Value = readReg(addr: CC1101.MDMCFG1)
        let preambleLengthSetting = (mdmcfg1Value >> 4) & 0x07
        
        // Convert the setting back to actual byte count
        switch preambleLengthSetting {
        case 0: return 2
        case 1: return 3
        case 2: return 4
        case 3: return 6
        case 4: return 8
        case 5: return 12
        case 6: return 16
        case 7: return 24
        default: return 2 // Should never happen
        }
    }
    
    // MARK: - AGC Methods
    func setMaxDvgaGain(maxDvgaGain: UInt8) -> Bool {
        // MAX_DVGA_GAIN is in bits 7:6 of AGCCTRL2
        if maxDvgaGain > 3 {
            return false // Invalid gain
        }
        
        let currentValue = readReg(addr: CC1101.AGCCTRL2)
        let newValue = (currentValue & 0x3F) | (maxDvgaGain << 6)
        
        writeReg(addr: CC1101.AGCCTRL2, value: newValue)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.AGCCTRL2)
        return ((confirmValue >> 6) & 0x03) == maxDvgaGain
    }
    
    func getMaxDvgaGain() -> UInt8 {
        let agcctrl2Value = readReg(addr: CC1101.AGCCTRL2)
        return (agcctrl2Value >> 6) & 0x03
    }
    
    func setMaxLnaGain(maxLnaGain: UInt8) -> Bool {
        // MAX_LNA_GAIN is in bits 5:3 of AGCCTRL2
        if maxLnaGain > 7 {
            return false // Invalid gain
        }
        
        let currentValue = readReg(addr: CC1101.AGCCTRL2)
        let newValue = (currentValue & 0xC7) | (maxLnaGain << 3)
        
        writeReg(addr: CC1101.AGCCTRL2, value: newValue)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.AGCCTRL2)
        return ((confirmValue >> 3) & 0x07) == maxLnaGain
    }
    
    func getMaxLnaGain() -> UInt8 {
        let agcctrl2Value = readReg(addr: CC1101.AGCCTRL2)
        return (agcctrl2Value >> 3) & 0x07
    }
    
    // MARK: - Carrier Sense Methods
    func setCarrierSenseRelThr(carrierSenseRelThr: UInt8) -> Bool {
        // CARRIER_SENSE_REL_THR is in bits 5:4 of AGCCTRL1
        if carrierSenseRelThr > 3 {
            return false // Invalid threshold
        }
        
        let currentValue = readReg(addr: CC1101.AGCCTRL1)
        let newValue = (currentValue & 0xCF) | (carrierSenseRelThr << 4)
        
        writeReg(addr: CC1101.AGCCTRL1, value: newValue)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.AGCCTRL1)
        return ((confirmValue >> 4) & 0x03) == carrierSenseRelThr
    }
    
    func getCarrierSenseRelThr() -> UInt8 {
        let agcctrl1Value = readReg(addr: CC1101.AGCCTRL1)
        return (agcctrl1Value >> 4) & 0x03
    }
    
    func setCarrierSenseAbsThr(carrierSenseAbsThr: UInt8) -> Bool {
        // CARRIER_SENSE_ABS_THR is in bits 3:0 of AGCCTRL1
        if carrierSenseAbsThr > 15 {
            return false // Invalid threshold
        }
        
        let currentValue = readReg(addr: CC1101.AGCCTRL1)
        let newValue = (currentValue & 0xF0) | carrierSenseAbsThr
        
        writeReg(addr: CC1101.AGCCTRL1, value: newValue)
        
        // Verify
        let confirmValue = readReg(addr: CC1101.AGCCTRL1)
        return (confirmValue & 0x0F) == carrierSenseAbsThr
    }
    
    func getCarrierSenseAbsThr() -> UInt8 {
        let agcctrl1Value = readReg(addr: CC1101.AGCCTRL1)
        return agcctrl1Value & 0x0F
    }
}
