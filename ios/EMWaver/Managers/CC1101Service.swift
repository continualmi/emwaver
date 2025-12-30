import Foundation

final class CC1101Service {
    private let bleManager: BLEManager

    init(bleManager: BLEManager) {
        self.bleManager = bleManager
    }

    enum CC1101Error: LocalizedError {
        case notConnected
        case deviceError
        case invalidResponse

        var errorDescription: String? {
            switch self {
            case .notConnected:
                return "Not connected to EMWaver."
            case .deviceError:
                return "Device returned error (0xFF)."
            case .invalidResponse:
                return "Invalid response from device."
            }
        }
    }

    // MARK: - High-level helpers

    func initialize(timeoutMs: Int = 1500) throws {
        _ = try sendAck("cc1101 init\n", timeoutMs: timeoutMs)
        _ = try sendAck(String(format: "cc1101 strobe --cmd=0x%02X\n", 0x30), timeoutMs: timeoutMs) // SRES
        _ = try sendAck("cc1101 apply_defaults\n", timeoutMs: timeoutMs)
    }

    func openDevice(miso: Int? = nil,
                    mosi: Int? = nil,
                    sck: Int? = nil,
                    cs: Int? = nil,
                    csActiveHigh: Bool? = nil,
                    timeoutMs: Int = 1500) throws {
        var args: [String] = []
        if let miso = miso { args.append("--miso=\(miso)") }
        if let mosi = mosi { args.append("--mosi=\(mosi)") }
        if let sck = sck { args.append("--sck=\(sck)") }
        if let cs = cs { args.append("--cs=\(cs)") }
        if let csActiveHigh = csActiveHigh { args.append("--cs_active_high=\(csActiveHigh ? 1 : 0)") }
        let suffix = args.isEmpty ? "" : " " + args.joined(separator: " ")
        _ = try sendAck("cc1101 init\(suffix)\n", timeoutMs: timeoutMs)
    }

    func strobe(_ value: UInt8, timeoutMs: Int = 1000) throws {
        _ = try sendAck(String(format: "cc1101 strobe --cmd=0x%02X\n", value), timeoutMs: timeoutMs)
    }

    func writeReg(_ reg: UInt8, value: UInt8, timeoutMs: Int = 1000) throws {
        _ = try sendAck(String(format: "cc1101 write --reg=0x%02X --val=0x%02X\n", reg, value), timeoutMs: timeoutMs)
    }

    func readReg(_ reg: UInt8, timeoutMs: Int = 1000) throws -> UInt8 {
        let data = try sendData(String(format: "cc1101 read --reg=0x%02X\n", reg), timeoutMs: timeoutMs)
        guard data.count >= 1 else { throw CC1101Error.invalidResponse }
        return data[0]
    }

    func writeBurst(_ reg: UInt8, bytes: [UInt8], timeoutMs: Int = 1000) throws {
        guard !bytes.isEmpty else { return }
        let csv = bytes.map { String(format: "0x%02X", $0) }.joined(separator: ",")
        _ = try sendAck(String(format: "cc1101 write_burst --reg=0x%02X --data=%@\n", reg, csv), timeoutMs: timeoutMs)
    }

    func readBurst(_ reg: UInt8, len: Int, timeoutMs: Int = 1000) throws -> [UInt8] {
        guard len > 0 else { return [] }
        let data = try sendData(String(format: "cc1101 read_burst --reg=0x%02X --len=%d\n", reg, len), timeoutMs: timeoutMs)
        guard data.count >= len else { throw CC1101Error.invalidResponse }
        return Array(data.prefix(len))
    }

    func setFrequencyMHz(_ mhz: Double, timeoutMs: Int = 1000) throws {
        _ = try sendAck(String(format: "cc1101 set_freq --mhz=%.6f\n", mhz), timeoutMs: timeoutMs)
    }

    func setDataRate(_ bps: Int, timeoutMs: Int = 1000) throws {
        _ = try sendAck("cc1101 set_datarate --bps=\(bps)\n", timeoutMs: timeoutMs)
    }

    func setModulationAndPower(modulation: Int, dbm: Int, timeoutMs: Int = 1000) throws {
        _ = try sendAck("cc1101 set_mod_power --mod=\(modulation) --dbm=\(dbm)\n", timeoutMs: timeoutMs)
    }

    // MARK: - Transport

    private func sendAck(_ command: String, timeoutMs: Int) throws -> UInt8 {
        let data = try sendData(command, timeoutMs: timeoutMs)

        if BLEManager.isPaddedErrFrame(data) || (data.count == 1 && data[0] == 0xFF) {
            throw CC1101Error.deviceError
        }

        if BLEManager.isPaddedOkFrame(data) || (data.count == 1 && data[0] == 0x00) {
            return 0x00
        }

        throw CC1101Error.invalidResponse
    }

    private func sendData(_ command: String, timeoutMs: Int) throws -> Data {
        guard bleManager.isConnected else { throw CC1101Error.notConnected }
        guard let response = bleManager.sendCommand(Data(command.utf8), timeout: timeoutMs) else {
            throw CC1101Error.invalidResponse
        }
        return response
    }
}
