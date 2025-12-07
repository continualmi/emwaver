import Foundation
import JavaScriptCore
import SwiftUI

@objc protocol CC1101JSExport: JSExport {
    func spiStrobe(_ commandStrobe: UInt8)
    func initialize()
    var exposedConstants: [String: Any] { get }
    func writeReg(_ addr: UInt8, _ value: UInt8)
    func readReg(_ addr: UInt8) -> UInt8
    func writeBurstReg(_ addr: UInt8, _ data: [UInt8], _ len: UInt8)
    func readBurstReg(_ addr: UInt8, _ len: Int) -> [UInt8]
    func setFrequencyMHz(_ frequencyMHz: Double) -> Bool
    func getFrequency() -> Double
    func setDataRate(_ bitRate: Int) -> Bool
    func getDataRate() -> Int
    func setBandwidth(_ bandwidth: Double) -> Bool
    func getBandwidth() -> Double
    func setDeviation(_ deviation: Int) -> Bool
    func getDeviation() -> Int
    func setModulation(_ modulation: UInt8) -> Bool
    func getModulation() -> Int
    func setPowerLevel(_ powerLevel: Int) -> Bool
    func getPowerLevel() -> Int
    func setGDOMode(_ gdo2: UInt8, _ gdo1: UInt8, _ gdo0: UInt8)
    func calibrate()
    func select315MHzAntenna()
    func select433MHzAntenna()
    func setModulationAndPower(_ modulation: UInt8, _ dbm: Int) -> Bool
}

@objc final class CC1101Wrapper: NSObject, CC1101JSExport {
    private let cc1101: CC1101

    private static let constants: [String: Any] = {
        var map: [String: Any] = [:]
        map["IOCFG2"] = CC1101.IOCFG2
        map["IOCFG1"] = CC1101.IOCFG1
        map["IOCFG0"] = CC1101.IOCFG0
        map["FIFOTHR"] = CC1101.FIFOTHR
        map["SYNC1"] = CC1101.SYNC1
        map["SYNC0"] = CC1101.SYNC0
        map["PKTLEN"] = CC1101.PKTLEN
        map["PKTCTRL1"] = CC1101.PKTCTRL1
        map["PKTCTRL0"] = CC1101.PKTCTRL0
        map["ADDR"] = CC1101.ADDR
        map["CHANNR"] = CC1101.CHANNR
        map["FSCTRL1"] = CC1101.FSCTRL1
        map["FSCTRL0"] = CC1101.FSCTRL0
        map["FREQ2"] = CC1101.FREQ2
        map["FREQ1"] = CC1101.FREQ1
        map["FREQ0"] = CC1101.FREQ0
        map["MDMCFG4"] = CC1101.MDMCFG4
        map["MDMCFG3"] = CC1101.MDMCFG3
        map["MDMCFG2"] = CC1101.MDMCFG2
        map["MDMCFG1"] = CC1101.MDMCFG1
        map["MDMCFG0"] = CC1101.MDMCFG0
        map["DEVIATN"] = CC1101.DEVIATN
        map["MCSM2"] = CC1101.MCSM2
        map["MCSM1"] = CC1101.MCSM1
        map["MCSM0"] = CC1101.MCSM0
        map["FOCCFG"] = CC1101.FOCCFG
        map["BSCFG"] = CC1101.BSCFG
        map["AGCCTRL2"] = CC1101.AGCCTRL2
        map["AGCCTRL1"] = CC1101.AGCCTRL1
        map["AGCCTRL0"] = CC1101.AGCCTRL0
        map["WOREVT1"] = CC1101.WOREVT1
        map["WORCTRL"] = CC1101.WORCTRL
        map["FREND1"] = CC1101.FREND1
        map["FREND0"] = CC1101.FREND0
        map["FSCAL3"] = CC1101.FSCAL3
        map["FSCAL2"] = CC1101.FSCAL2
        map["FSCAL1"] = CC1101.FSCAL1
        map["FSCAL0"] = CC1101.FSCAL0
        map["RCCTRL1"] = CC1101.RCCTRL1
        map["RCCTRL0"] = CC1101.RCCTRL0
        map["FSTEST"] = CC1101.FSTEST
        map["PTEST"] = CC1101.PTEST
        map["AGCTEST"] = CC1101.AGCTEST
        map["TEST2"] = CC1101.TEST2
        map["TEST1"] = CC1101.TEST1
        map["TEST0"] = CC1101.TEST0
        map["SRES"] = CC1101.SRES
        map["SFSTXON"] = CC1101.SFSTXON
        map["SXOFF"] = CC1101.SXOFF
        map["SCAL"] = CC1101.SCAL
        map["SRX"] = CC1101.SRX
        map["STX"] = CC1101.STX
        map["SIDLE"] = CC1101.SIDLE
        map["SAFC"] = CC1101.SAFC
        map["SWOR"] = CC1101.SWOR
        map["SPWD"] = CC1101.SPWD
        map["SFRX"] = CC1101.SFRX
        map["SFTX"] = CC1101.SFTX
        map["SWORRST"] = CC1101.SWORRST
        map["SNOP"] = CC1101.SNOP
        map["PARTNUM"] = CC1101.PARTNUM
        map["VERSION"] = CC1101.VERSION
        map["FREQEST"] = CC1101.FREQEST
        map["LQI"] = CC1101.LQI
        map["RSSI"] = CC1101.RSSI
        map["MARCSTATE"] = CC1101.MARCSTATE
        map["WORTIME1"] = CC1101.WORTIME1
        map["WORTIME0"] = CC1101.WORTIME0
        map["PKTSTATUS"] = CC1101.PKTSTATUS
        map["VCO_VC_DAC"] = CC1101.VCO_VC_DAC
        map["TXBYTES"] = CC1101.TXBYTES
        map["RXBYTES"] = CC1101.RXBYTES
        map["PATABLE"] = CC1101.PATABLE
        map["TXFIFO"] = CC1101.TXFIFO
        map["RXFIFO"] = CC1101.RXFIFO
        map["MOD_2FSK"] = CC1101.MOD_2FSK
        map["MOD_GFSK"] = CC1101.MOD_GFSK
        map["MOD_ASK"] = CC1101.MOD_ASK
        map["MOD_4FSK"] = CC1101.MOD_4FSK
        map["MOD_MSK"] = CC1101.MOD_MSK
        map["WRITE_BURST"] = CC1101.WRITE_BURST
        map["READ_SINGLE"] = CC1101.READ_SINGLE
        map["READ_BURST"] = CC1101.READ_BURST
        map["BYTES_IN_RXFIFO"] = CC1101.BYTES_IN_RXFIFO
        map["GDO_INPUT"] = CC1101.GDO_INPUT
        map["GDO_OUTPUT"] = CC1101.GDO_OUTPUT
        map["GDO_0"] = CC1101.GDO_0
        map["GDO_2"] = CC1101.GDO_2
        map["POWER_LEVELS"] = CC1101.POWER_LEVELS
        map["MODE_PACKET"] = CC1101.MODE_PACKET
        map["MODE_CONTINUOUS"] = CC1101.MODE_CONTINUOUS
        map["SYNC_MODE_NONE"] = CC1101.SYNC_MODE_NONE
        map["SYNC_MODE_15_16"] = CC1101.SYNC_MODE_15_16
        map["SYNC_MODE_16_16"] = CC1101.SYNC_MODE_16_16
        map["SYNC_MODE_30_32"] = CC1101.SYNC_MODE_30_32
        map["SYNC_MODE_NONE_CS"] = CC1101.SYNC_MODE_NONE_CS
        map["SYNC_MODE_15_16_CS"] = CC1101.SYNC_MODE_15_16_CS
        map["SYNC_MODE_16_16_CS"] = CC1101.SYNC_MODE_16_16_CS
        map["SYNC_MODE_30_32_CS"] = CC1101.SYNC_MODE_30_32_CS
        map["POWER_MINUS_30_DBM"] = CC1101.POWER_MINUS_30_DBM
        map["POWER_MINUS_20_DBM"] = CC1101.POWER_MINUS_20_DBM
        map["POWER_MINUS_15_DBM"] = CC1101.POWER_MINUS_15_DBM
        map["POWER_MINUS_10_DBM"] = CC1101.POWER_MINUS_10_DBM
        map["POWER_0_DBM"] = CC1101.POWER_0_DBM
        map["POWER_5_DBM"] = CC1101.POWER_5_DBM
        map["POWER_7_DBM"] = CC1101.POWER_7_DBM
        map["POWER_10_DBM"] = CC1101.POWER_10_DBM
        return map
    }()

    init(cc1101: CC1101) {
        self.cc1101 = cc1101
        super.init()
    }

    func spiStrobe(_ commandStrobe: UInt8) {
        cc1101.spiStrobe(commandStrobe: commandStrobe)
    }

    func initialize() {
        spiStrobe(0x30)
        Thread.sleep(forTimeInterval: 0.1)
    }

    var exposedConstants: [String: Any] { Self.constants }

    func writeReg(_ addr: UInt8, _ value: UInt8) {
        cc1101.writeReg(addr: addr, value: value)
    }

    func readReg(_ addr: UInt8) -> UInt8 {
        cc1101.readReg(addr: addr)
    }

    func writeBurstReg(_ addr: UInt8, _ data: [UInt8], _ len: UInt8) {
        cc1101.writeBurstReg(addr: addr, data: data, len: len)
    }

    func readBurstReg(_ addr: UInt8, _ len: Int) -> [UInt8] {
        cc1101.readBurstReg(addr: addr, len: len)
    }

    func setFrequencyMHz(_ frequencyMHz: Double) -> Bool {
        cc1101.setFrequencyMHz(frequencyMHz: frequencyMHz)
    }

    func getFrequency() -> Double {
        cc1101.getFrequency()
    }

    func setDataRate(_ bitRate: Int) -> Bool {
        cc1101.setDataRate(bitRate: bitRate)
    }

    func getDataRate() -> Int {
        cc1101.getDataRate()
    }

    func setBandwidth(_ bandwidth: Double) -> Bool {
        cc1101.setBandwidth(bandwidth: bandwidth)
    }

    func getBandwidth() -> Double {
        cc1101.getBandwidth()
    }

    func setDeviation(_ deviation: Int) -> Bool {
        cc1101.setDeviation(deviation: deviation)
    }

    func getDeviation() -> Int {
        cc1101.getDeviation()
    }

    func setModulation(_ modulation: UInt8) -> Bool {
        cc1101.setModulation(modulation: modulation)
    }

    func getModulation() -> Int {
        cc1101.getModulation()
    }

    func setPowerLevel(_ powerLevel: Int) -> Bool {
        cc1101.setPowerLevel(powerLevel: powerLevel)
    }

    func getPowerLevel() -> Int {
        cc1101.getPowerLevel()
    }

    func setGDOMode(_ gdo2: UInt8, _ gdo1: UInt8, _ gdo0: UInt8) {
        cc1101.setGDOMode(gdo2: gdo2, gdo1: gdo1, gdo0: gdo0)
    }

    func calibrate() {
        cc1101.calibrate()
    }

    func select315MHzAntenna() {
        cc1101.select315MHzAntenna()
    }

    func select433MHzAntenna() {
        cc1101.select433MHzAntenna()
    }

    func setModulationAndPower(_ modulation: UInt8, _ dbm: Int) -> Bool {
        cc1101.setModulationAndPower(modulation: modulation, dbm: dbm)
    }
}

@objc protocol BLEManagerJSExport: JSExport {
    func getBuffer() -> Data
    func clearBuffer()
    func loadBuffer(data: Data)
    func sendPacket(_ data: Data)
    func sendCommand(_ command: Data, timeout: Int) -> Data?
    func transmitBuffer()
}

@objc final class BLEServiceWrapper: NSObject, BLEManagerJSExport {
    private let bleManager: BLEManager

    init(bleManager: BLEManager) {
        self.bleManager = bleManager
        super.init()
    }

    func getBuffer() -> Data {
        bleManager.getBuffer()
    }

    func clearBuffer() {
        bleManager.clearBuffer()
    }

    func loadBuffer(data: Data) {
        bleManager.loadBuffer(data: data)
    }

    func sendPacket(_ data: Data) {
        bleManager.sendPacket(data)
    }

    func sendCommand(_ command: Data, timeout: Int) -> Data? {
        bleManager.sendCommand(command, timeout: timeout)
    }

    func transmitBuffer() {
        bleManager.transmitBuffer()
    }
}

@MainActor
final class WaveletPreviewManager: ObservableObject {
    struct Dialog: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    @Published var isPreviewVisible = false
    @Published var isRendering = false
    @Published var waveletTree: WaveletTree?
    @Published var consoleLines: [String] = []
    @Published var dialog: Dialog?
    @Published var activeScriptName: String?

    private weak var bleManager: BLEManager?
    private var waveletEngine: WaveletEngine?
    private let consoleLimit = 500

    func attach(bleManager: BLEManager) {
        self.bleManager = bleManager
        registerBindings()
    }

    func updateConnectionState(isConnected: Bool) {
        guard bleManager != nil else { return }
        registerBindings()
    }

    func render(script: String, name: String?, moduleSources: [String: String]) {
        let trimmed = script.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        setupEngineIfNeeded()
        guard let engine = waveletEngine else { return }
        engine.updateModuleSources(moduleSources)

        activeScriptName = name
        isPreviewVisible = true
        isRendering = true
        waveletTree = nil
        clearConsole()

        engine.execute(script: trimmed) { [weak self] in
            guard let self else { return }
            self.isRendering = false
        }
    }

    func exitPreview() {
        isPreviewVisible = false
        isRendering = false
        waveletTree = nil
        activeScriptName = nil
    }

    func clearConsole() {
        consoleLines.removeAll()
    }

    func invoke(token: String, arguments: [Any]) {
        waveletEngine?.invoke(handler: token, arguments: arguments)
    }

    private func setupEngineIfNeeded() {
        if waveletEngine != nil {
            registerBindings()
            return
        }

        let engine = WaveletEngine()
        engine.setup(
            printHandler: { [weak self] message in
                guard let self else { return }
                Task { @MainActor in
                    self.appendLine(message)
                }
            },
            renderHandler: { [weak self] tree in
                guard let self else { return }
                self.waveletTree = tree
                self.isRendering = false
                self.isPreviewVisible = true
            },
            dialogHandler: { [weak self] title, message in
                guard let self else { return }
                self.dialog = Dialog(title: title.isEmpty ? "Wavelet" : title, message: message)
            },
            bindings: buildBindings()
        )
        waveletEngine = engine
    }

    private func registerBindings() {
        guard let engine = waveletEngine else { return }
        engine.registerGlobalBindings(buildBindings())
    }

    private func buildBindings() -> [String: Any] {
        var bindings: [String: Any] = [:]
        if let bleManager {
            bindings["BLEService"] = BLEServiceWrapper(bleManager: bleManager)
        }
        return bindings
    }

    private func appendLine(_ line: String) {
        consoleLines.append(line)
        if consoleLines.count > consoleLimit {
            consoleLines.removeFirst(consoleLines.count - consoleLimit)
        }
    }
}
