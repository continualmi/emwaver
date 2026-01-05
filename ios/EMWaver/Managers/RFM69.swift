/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation

class RFM69 {
    // MARK: - Constants
    
    // Register definitions
    static let REG_FIFO: UInt8 = 0x00
    static let REG_OPMODE: UInt8 = 0x01
    static let REG_DATAMODUL: UInt8 = 0x02
    static let REG_BITRATEMSB: UInt8 = 0x03
    static let REG_BITRATELSB: UInt8 = 0x04
    static let REG_FDEVMSB: UInt8 = 0x05
    static let REG_FDEVLSB: UInt8 = 0x06
    static let REG_FRFMSB: UInt8 = 0x07
    static let REG_FRFMID: UInt8 = 0x08
    static let REG_FRFLSB: UInt8 = 0x09
    static let REG_OSC1: UInt8 = 0x0A
    static let REG_AFCCTRL: UInt8 = 0x0B
    static let REG_LOWBAT: UInt8 = 0x0C
    static let REG_LISTEN1: UInt8 = 0x0D
    static let REG_LISTEN2: UInt8 = 0x0E
    static let REG_LISTEN3: UInt8 = 0x0F
    static let REG_VERSION: UInt8 = 0x10
    static let REG_PALEVEL: UInt8 = 0x11
    static let REG_PARAMP: UInt8 = 0x12
    static let REG_OCP: UInt8 = 0x13
    static let REG_LNA: UInt8 = 0x18
    static let REG_RXBW: UInt8 = 0x19
    static let REG_AFCBW: UInt8 = 0x1A
    static let REG_OOKPEAK: UInt8 = 0x1B
    static let REG_OOKAVG: UInt8 = 0x1C
    static let REG_OOKFIX: UInt8 = 0x1D
    static let REG_AFCFEI: UInt8 = 0x1E
    static let REG_AFCMSB: UInt8 = 0x1F
    static let REG_AFCLSB: UInt8 = 0x20
    static let REG_FEIMSB: UInt8 = 0x21
    static let REG_FEILSB: UInt8 = 0x22
    static let REG_RSSICONFIG: UInt8 = 0x23
    static let REG_RSSIVALUE: UInt8 = 0x24
    static let REG_DIOMAPPING1: UInt8 = 0x25
    static let REG_DIOMAPPING2: UInt8 = 0x26
    static let REG_IRQFLAGS1: UInt8 = 0x27
    static let REG_IRQFLAGS2: UInt8 = 0x28
    static let REG_RSSITHRESH: UInt8 = 0x29
    static let REG_RXTIMEOUT1: UInt8 = 0x2A
    static let REG_RXTIMEOUT2: UInt8 = 0x2B
    static let REG_PREAMBLEMSB: UInt8 = 0x2C
    static let REG_PREAMBLELSB: UInt8 = 0x2D
    static let REG_SYNCCONFIG: UInt8 = 0x2E
    static let REG_SYNCVALUE1: UInt8 = 0x2F
    static let REG_PACKETCONFIG1: UInt8 = 0x37
    static let REG_PAYLOADLENGTH: UInt8 = 0x38
    static let REG_NODEADRS: UInt8 = 0x39
    static let REG_BROADCASTADRS: UInt8 = 0x3A
    static let REG_AUTOMODES: UInt8 = 0x3B
    static let REG_FIFOTHRESH: UInt8 = 0x3C
    static let REG_PACKETCONFIG2: UInt8 = 0x3D
    static let REG_TEMP1: UInt8 = 0x4E
    static let REG_TEMP2: UInt8 = 0x4F
    static let REG_TESTLNA: UInt8 = 0x58
    static let REG_TESTPA1: UInt8 = 0x5A
    static let REG_TESTPA2: UInt8 = 0x5C
    static let REG_TESTDAGC: UInt8 = 0x6F
    
    // OpMode bits
    static let RF_OPMODE_SEQUENCER_OFF: UInt8 = 0x80
    static let RF_OPMODE_SEQUENCER_ON: UInt8 = 0x00
    static let RF_OPMODE_LISTEN_ON: UInt8 = 0x40
    static let RF_OPMODE_LISTEN_OFF: UInt8 = 0x00
    static let RF_OPMODE_LISTENABORT: UInt8 = 0x20
    static let RF_OPMODE_SLEEP: UInt8 = 0x00
    static let RF_OPMODE_STANDBY: UInt8 = 0x04
    static let RF_OPMODE_SYNTHESIZER: UInt8 = 0x08
    static let RF_OPMODE_TRANSMITTER: UInt8 = 0x0C
    static let RF_OPMODE_RECEIVER: UInt8 = 0x10
    
    // DataModul bits
    static let RF_DATAMODUL_DATAMODE_PACKET: UInt8 = 0x00
    static let RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC: UInt8 = 0x40
    static let RF_DATAMODUL_DATAMODE_CONTINUOUS: UInt8 = 0x60
    static let RF_DATAMODUL_MODULATIONTYPE_FSK: UInt8 = 0x00
    static let RF_DATAMODUL_MODULATIONTYPE_OOK: UInt8 = 0x08
    static let RF_DATAMODUL_MODULATIONSHAPING_00: UInt8 = 0x00
    
    // PaLevel bits
    static let RF_PALEVEL_PA0_ON: UInt8 = 0x80
    static let RF_PALEVEL_PA0_OFF: UInt8 = 0x00
    static let RF_PALEVEL_PA1_ON: UInt8 = 0x40
    static let RF_PALEVEL_PA1_OFF: UInt8 = 0x00
    static let RF_PALEVEL_PA2_ON: UInt8 = 0x20
    static let RF_PALEVEL_PA2_OFF: UInt8 = 0x00
    
    // OCP bits
    static let RF_OCP_ON: UInt8 = 0x1A
    static let RF_OCP_OFF: UInt8 = 0x0F
    
    // LNA bits
    static let RF_LNA_ZIN_50: UInt8 = 0x00
    static let RF_LNA_ZIN_200: UInt8 = 0x80
    static let RF_LNA_GAINSELECT_AUTO: UInt8 = 0x00
    static let RF_LNA_GAINSELECT_MAX: UInt8 = 0x08
    static let RF_LNA_GAINSELECT_MAXMINUS6: UInt8 = 0x10
    static let RF_LNA_GAINSELECT_MAXMINUS12: UInt8 = 0x18
    static let RF_LNA_GAINSELECT_MAXMINUS24: UInt8 = 0x20
    static let RF_LNA_GAINSELECT_MAXMINUS36: UInt8 = 0x28
    static let RF_LNA_GAINSELECT_MAXMINUS48: UInt8 = 0x30
    
    // OokPeak bits
    static let RF_OOKPEAK_THRESHTYPE_FIXED: UInt8 = 0x00
    static let RF_OOKPEAK_THRESHTYPE_PEAK: UInt8 = 0x40
    static let RF_OOKPEAK_PEAKTHRESHSTEP_000: UInt8 = 0x00
    static let RF_OOKPEAK_PEAKTHRESHDEC_000: UInt8 = 0x00
    
    // RSSI Config bits
    static let RF_RSSI_START: UInt8 = 0x01
    static let RF_RSSI_DONE: UInt8 = 0x02
    
    // IrqFlags1 bits
    static let RF_IRQFLAGS1_MODEREADY: UInt8 = 0x80
    
    // Modes
    static let MODE_SLEEP: Int = 0
    static let MODE_STANDBY: Int = 1
    static let MODE_SYNTH: Int = 2
    static let MODE_RX: Int = 3
    static let MODE_TX: Int = 4
    
    // Modulation types
    static let MOD_FSK: Int = 0
    static let MOD_OOK: Int = 1
    
    // PA modes
    static let PA_MODE_PA0: Int = 1
    static let PA_MODE_PA1: Int = 2
    static let PA_MODE_PA1_PA2: Int = 3
    static let PA_MODE_PA1_PA2_20DBM: Int = 4
    
    // Frequency step (FXOSC / 2^19)
    private static let FSTEP: Double = 61.03515625
    
    private var deviceOpen = false
    private var commandObserver: ((String) -> Void)?
    
    // MARK: - Properties
    private let bleManager: USBManager
    
    // MARK: - Initialization
    init(bleManager: USBManager) {
        self.bleManager = bleManager
    }
    
    func setCommandObserver(_ observer: ((String) -> Void)?) {
        self.commandObserver = observer
    }
    
    func clearCommandObserver() {
        self.commandObserver = nil
    }
    
    // MARK: - Device Management
    func openDevice() -> Bool {
        if deviceOpen {
            print("RFM69: Device already open")
            return true
        }
        
        // Desktop parity: use the dedicated `rfm69` commands (fits the 64B command protocol).
        let settings = SettingsManager.shared
        let csPin = settings.rfm69CsPin
        
        let command = "rfm69 init --cs=\(csPin)\n"
        notifyCommandObserver(command.trimmingCharacters(in: .whitespacesAndNewlines))
        
        if let response = bleManager.sendCommand(Data(command.utf8), timeout: 1000) {
            if USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[response.startIndex] == 0xFF) {
                print("RFM69: SPI open failed (device error)")
                return false
            }
            let parsed = parseRawResponse(response)
            if parsed.isEmpty {
                deviceOpen = true
                print("RFM69: SPI device opened successfully")
                return true
            }
        }
        
        print("RFM69: Failed to open SPI device")
        return false
    }
    
    func closeDevice() -> Bool {
        // No explicit close command; just drop local state.
        deviceOpen = false
        return true
    }
    
    private func parseRawResponse(_ response: Data?) -> [UInt8] {
        guard let response = response, !response.isEmpty else {
            return []
        }
        if USBManager.isPaddedOkFrame(response) {
            return []
        }
        if USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[response.startIndex] == 0xFF) {
            print("RFM69: Device returned error")
            return []
        }
        if response.count == 1, response[response.startIndex] == 0x00 {
            return []
        }
        return Array(response)
    }
    
    private func notifyCommandObserver(_ command: String) {
        commandObserver?(command)
    }
    
    func readReg(addr: UInt8) -> UInt8 {
        let command = String(format: "rfm69 read --reg=0x%02X\n", addr)
        notifyCommandObserver(command.trimmingCharacters(in: .whitespacesAndNewlines))
        
        if !deviceOpen {
            print("RFM69: Attempting to read register while device is closed; opening now")
            if !openDevice() {
                print("RFM69: Failed to open device before register read")
                return 0
            }
        }
        
        if let response = bleManager.sendCommand(Data(command.utf8), timeout: 1000) {
            if USBManager.isPaddedErrFrame(response) || (response.count == 1 && response[response.startIndex] == 0xFF) {
                print("RFM69: Device returned error during register read")
                return 0
            }
            // rfm69 read returns a single data byte (padded to 64B over BLE).
            if let first = response.first {
                return first
            }
        }
        
        print("RFM69: Empty parsed response for register 0x\(String(format: "%02X", addr))")
        return 0
    }
    
    func writeReg(addr: UInt8, value: UInt8) {
        if !deviceOpen {
            print("RFM69: Attempting to write register while device is closed; opening now")
            if !openDevice() {
                print("RFM69: Failed to open device before register write")
                return
            }
        }
        
        let command = String(format: "rfm69 write --reg=0x%02X --val=0x%02X\n", addr, value)
        notifyCommandObserver(command.trimmingCharacters(in: .whitespacesAndNewlines))
        _ = bleManager.sendCommand(Data(command.utf8), timeout: 1000)
    }
    
    // MARK: - Mode Control
    func setMode(_ mode: Int) {
        var currentOpMode = readReg(addr: RFM69.REG_OPMODE)
        var newOpMode: UInt8
        
        switch mode {
        case RFM69.MODE_TX:
            newOpMode = (currentOpMode & 0xE3) | RFM69.RF_OPMODE_TRANSMITTER
        case RFM69.MODE_RX:
            newOpMode = (currentOpMode & 0xE3) | RFM69.RF_OPMODE_RECEIVER
            writeReg(addr: RFM69.REG_TESTPA1, value: 0x55)
            writeReg(addr: RFM69.REG_TESTPA2, value: 0x70)
            writeReg(addr: RFM69.REG_OCP, value: RFM69.RF_OCP_ON)
        case RFM69.MODE_SYNTH:
            newOpMode = (currentOpMode & 0xE3) | RFM69.RF_OPMODE_SYNTHESIZER
        case RFM69.MODE_STANDBY:
            newOpMode = (currentOpMode & 0xE3) | RFM69.RF_OPMODE_STANDBY
        case RFM69.MODE_SLEEP:
            newOpMode = (currentOpMode & 0xE3) | RFM69.RF_OPMODE_SLEEP
        default:
            return
        }
        
        writeReg(addr: RFM69.REG_OPMODE, value: newOpMode)
    }
    
    // MARK: - Frequency Methods
    func setFrequencyMHz(_ freqMHz: Float) {
        let freqHz = Int64(freqMHz / Float(RFM69.FSTEP) * 1_000_000.0)
        writeReg(addr: RFM69.REG_FRFMSB, value: UInt8((freqHz >> 16) & 0xFF))
        writeReg(addr: RFM69.REG_FRFMID, value: UInt8((freqHz >> 8) & 0xFF))
        writeReg(addr: RFM69.REG_FRFLSB, value: UInt8(freqHz & 0xFF))
    }
    
    func getFrequency() -> Double {
        let frfMsb = UInt64(readReg(addr: RFM69.REG_FRFMSB) & 0xFF)
        let frfMid = UInt64(readReg(addr: RFM69.REG_FRFMID) & 0xFF)
        let frfLsb = UInt64(readReg(addr: RFM69.REG_FRFLSB) & 0xFF)
        let freqHz = (frfMsb << 16) + (frfMid << 8) + frfLsb
        return (RFM69.FSTEP * Double(freqHz)) / 1_000_000.0
    }
    
    // MARK: - Data Rate Methods
    func setDataRate(_ bps: Int) {
        if bps <= 0 { return }
        let bitrate = 32_000_000 / bps
        writeReg(addr: RFM69.REG_BITRATEMSB, value: UInt8((bitrate >> 8) & 0xFF))
        writeReg(addr: RFM69.REG_BITRATELSB, value: UInt8(bitrate & 0xFF))
    }
    
    func getDataRate() -> Int {
        let msb = Int(readReg(addr: RFM69.REG_BITRATEMSB) & 0xFF)
        let lsb = Int(readReg(addr: RFM69.REG_BITRATELSB) & 0xFF)
        let bitrate = (msb << 8) | lsb
        if bitrate == 0 { return 0 }
        return 32_000_000 / bitrate
    }
    
    // MARK: - Deviation Methods
    func setDeviation(_ deviationHz: Int) {
        let deviation = deviationHz / 61
        writeReg(addr: RFM69.REG_FDEVMSB, value: UInt8((deviation >> 8) & 0xFF))
        writeReg(addr: RFM69.REG_FDEVLSB, value: UInt8(deviation & 0xFF))
    }
    
    func getDeviation() -> Int {
        let msb = Int(readReg(addr: RFM69.REG_FDEVMSB) & 0xFF)
        let lsb = Int(readReg(addr: RFM69.REG_FDEVLSB) & 0xFF)
        return ((msb << 8) | lsb) * 61
    }
    
    // MARK: - Bandwidth Methods
    func setBandwidth(_ bw: UInt8) {
        let currentRxBw = readReg(addr: RFM69.REG_RXBW)
        writeReg(addr: RFM69.REG_RXBW, value: (currentRxBw & 0xE0) | bw)
    }
    
    func getBandwidth() -> Double {
        // RFM69 bandwidth calculation
        // Formula: BW = F_XOSC / (2 * (RxBwMant + 1) * 2^(RxBwExp + 2))
        // Where F_XOSC = 32 MHz for RFM69
        let rxBw = readReg(addr: RFM69.REG_RXBW)
        let rxBwMant = (rxBw & 0x1C) >> 2  // Bits 4:2
        let rxBwExp = (rxBw & 0xE0) >> 5   // Bits 7:5
        
        let fXosc: Double = 32_000_000.0  // 32 MHz
        let denominator = 2.0 * Double(rxBwMant + 1) * pow(2.0, Double(rxBwExp + 2))
        let bandwidthHz = fXosc / denominator
        return bandwidthHz / 1000.0  // Convert to kHz
    }
    
    func setBandwidth(_ bandwidthkHz: Double) -> Bool {
        // Convert kHz to register value
        // Formula: BW = F_XOSC / (2 * (RxBwMant + 1) * 2^(RxBwExp + 2))
        let fXosc: Double = 32_000_000.0
        let bandwidthHz = bandwidthkHz * 1000.0
        
        var bestRxBw: UInt8 = 0
        var minDiff = Double.greatestFiniteMagnitude
        
        // Try all combinations of RxBwExp and RxBwMant
        for exp in 0..<8 {
            for mant in 0..<8 {
                let denominator = 2.0 * Double(mant + 1) * pow(2.0, Double(exp + 2))
                let calculatedBw = fXosc / denominator
                let diff = abs(calculatedBw - bandwidthHz)
                
                if diff < minDiff {
                    minDiff = diff
                    bestRxBw = UInt8((exp << 5) | (mant << 2))
                }
            }
        }
        
        setBandwidth(bestRxBw)
        return true
    }
    
    // MARK: - Modulation Methods
    func setModulation(_ modulation: Int) {
        if modulation == RFM69.MOD_OOK {
            writeReg(addr: RFM69.REG_DATAMODUL, value: RFM69.RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC | RFM69.RF_DATAMODUL_MODULATIONTYPE_OOK | RFM69.RF_DATAMODUL_MODULATIONSHAPING_00)
        } else {
            writeReg(addr: RFM69.REG_DATAMODUL, value: RFM69.RF_DATAMODUL_DATAMODE_CONTINUOUSNOBSYNC | RFM69.RF_DATAMODUL_MODULATIONTYPE_FSK | RFM69.RF_DATAMODUL_MODULATIONSHAPING_00)
        }
    }
    
    func getModulation() -> Int {
        let dataModul = readReg(addr: RFM69.REG_DATAMODUL)
        return ((dataModul & RFM69.RF_DATAMODUL_MODULATIONTYPE_OOK) != 0) ? RFM69.MOD_OOK : RFM69.MOD_FSK
    }
    
    // MARK: - Power Control Methods
    func setTransmitPower(_ dbm: Int, paMode: Int, ocp: Bool) {
        var paLevel: UInt8
        switch paMode {
        case RFM69.PA_MODE_PA0:
            paLevel = RFM69.RF_PALEVEL_PA0_ON | RFM69.RF_PALEVEL_PA1_OFF | RFM69.RF_PALEVEL_PA2_OFF | UInt8(dbm > 13 ? 31 : (dbm + 18))
        case RFM69.PA_MODE_PA1:
            paLevel = RFM69.RF_PALEVEL_PA0_OFF | RFM69.RF_PALEVEL_PA1_ON | RFM69.RF_PALEVEL_PA2_OFF | UInt8(dbm > 13 ? 31 : (dbm + 18))
        case RFM69.PA_MODE_PA1_PA2:
            paLevel = RFM69.RF_PALEVEL_PA0_OFF | RFM69.RF_PALEVEL_PA1_ON | RFM69.RF_PALEVEL_PA2_ON | UInt8(dbm > 17 ? 31 : (dbm + 14))
        case RFM69.PA_MODE_PA1_PA2_20DBM:
            writeReg(addr: RFM69.REG_TESTPA1, value: 0x5D)
            writeReg(addr: RFM69.REG_TESTPA2, value: 0x7C)
            paLevel = RFM69.RF_PALEVEL_PA0_OFF | RFM69.RF_PALEVEL_PA1_ON | RFM69.RF_PALEVEL_PA2_ON | UInt8(dbm > 20 ? 31 : (dbm + 11))
        default:
            paLevel = RFM69.RF_PALEVEL_PA0_OFF | RFM69.RF_PALEVEL_PA1_ON | RFM69.RF_PALEVEL_PA2_ON | 31
        }
        writeReg(addr: RFM69.REG_PALEVEL, value: paLevel)
        writeReg(addr: RFM69.REG_OCP, value: ocp ? RFM69.RF_OCP_ON : RFM69.RF_OCP_OFF)
    }
    
    func getPowerLevel() -> Int {
        let paLevel = readReg(addr: RFM69.REG_PALEVEL)
        let outputPower = Int(paLevel & 0x1F)
        
        let pa0 = (paLevel & RFM69.RF_PALEVEL_PA0_ON) != 0
        let pa1 = (paLevel & RFM69.RF_PALEVEL_PA1_ON) != 0
        let pa2 = (paLevel & RFM69.RF_PALEVEL_PA2_ON) != 0
        
        let testPa1 = readReg(addr: RFM69.REG_TESTPA1)
        let testPa2 = readReg(addr: RFM69.REG_TESTPA2)
        let is20dBm = (testPa1 == 0x5D) && (testPa2 == 0x7C)
        
        if pa0 && !pa1 && !pa2 {
            return outputPower - 18
        } else if !pa0 && pa1 && !pa2 {
            return outputPower - 18
        } else if !pa0 && pa1 && pa2 {
            if is20dBm {
                return outputPower - 11
            } else {
                return outputPower - 14
            }
        }
        return 0
    }
    
    func setPowerLevel(_ powerLevel: Int) -> Bool {
        // Default to PA1_PA2 mode for most power levels
        let paMode: Int
        let ocp: Bool
        
        if powerLevel <= 13 {
            paMode = RFM69.PA_MODE_PA1
            ocp = true
        } else if powerLevel <= 17 {
            paMode = RFM69.PA_MODE_PA1_PA2
            ocp = true
        } else {
            paMode = RFM69.PA_MODE_PA1_PA2_20DBM
            ocp = true
        }
        
        setTransmitPower(powerLevel, paMode: paMode, ocp: ocp)
        return true
    }
    
    // MARK: - RSSI Methods
    func readRSSI(forceTrigger: Bool = false) -> Int {
        if forceTrigger {
            writeReg(addr: RFM69.REG_RSSICONFIG, value: RFM69.RF_RSSI_START)
            var timeout = 0
            while (readReg(addr: RFM69.REG_RSSICONFIG) & RFM69.RF_RSSI_DONE) == 0x00 {
                Thread.sleep(forTimeInterval: 0.001)
                if timeout > 100 { break }
                timeout += 1
            }
        }
        return -Int((readReg(addr: RFM69.REG_RSSIVALUE) & 0xFF) >> 1)
    }
}
