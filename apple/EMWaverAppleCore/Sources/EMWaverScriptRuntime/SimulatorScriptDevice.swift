/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation

public enum SimulatorScriptDeviceError: Error, LocalizedError {
    case invalidFixture
    case unsupportedOpcode(UInt8)
    case unsupportedSubcommand(String, UInt8)
    case unknownPin(UInt8)
    case unsupportedPwmPin(UInt8)
    case malformedCommand(String)

    public var errorDescription: String? {
        switch self {
        case .invalidFixture:
            return "Invalid EMWaver simulator fixture."
        case .unsupportedOpcode(let opcode):
            return String(format: "Simulator unsupported opcode 0x%02X.", opcode)
        case .unsupportedSubcommand(let group, let subcommand):
            return String(format: "Simulator unsupported %@ subcommand 0x%02X.", group, subcommand)
        case .unknownPin(let pin):
            return "Simulator unknown pin \(pin)."
        case .unsupportedPwmPin(let pin):
            return "Simulator pin \(pin) does not support PWM."
        case .malformedCommand(let message):
            return "Simulator malformed command: \(message)."
        }
    }
}

public final class SimulatorScriptDevice: ScriptDevice {
    private static let statusOK: UInt8 = 0x80
    private static let statusError: UInt8 = 0x81

    private let fixture: SimulatorFixture
    private var buffer = Data()
    private var gpioLevels: [UInt8: UInt8]
    private var gpioModes: [UInt8: String]
    private let pins: Set<UInt8>
    private let pwmPins: Set<UInt8>
    private let lock = NSLock()

    public init(fixtureData: Data) throws {
        let decoded = try JSONDecoder().decode(SimulatorFixture.self, from: fixtureData)
        guard !decoded.board.type.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SimulatorScriptDeviceError.invalidFixture
        }

        self.fixture = decoded
        self.pins = Set(decoded.gpio.pins.map(\.number))
        self.pwmPins = Set(decoded.pwm.pins)
        self.gpioLevels = Dictionary(uniqueKeysWithValues: decoded.gpio.pins.map { ($0.number, min($0.initialLevel, 1)) })
        self.gpioModes = Dictionary(uniqueKeysWithValues: decoded.gpio.pins.map { ($0.number, "input") })
    }

    public convenience init(fixtureURL: URL) throws {
        try self.init(fixtureData: Data(contentsOf: fixtureURL))
    }

    public static func basicBoard() throws -> SimulatorScriptDevice {
        let fixture = """
        {
          "board": {
            "type": "emwaver-sim",
            "name": "EMWaver Simulator",
            "firmwareVersion": { "major": 1, "minor": 0 },
            "hardwareUid": "SIM-00000001",
            "protocolVersion": 1
          },
          "gpio": {
            "pins": [
              { "number": 0, "name": "D0", "modes": ["input", "output", "pwm", "adc"], "initialLevel": 0 },
              { "number": 1, "name": "D1", "modes": ["input", "output", "pwm"], "initialLevel": 0 },
              { "number": 2, "name": "D2", "modes": ["input", "output"], "initialLevel": 1 },
              { "number": 13, "name": "LED", "modes": ["input", "output", "pwm"], "initialLevel": 0 }
            ]
          },
          "adc": {
            "pinValues": { "0": 2048, "1": 1024, "2": 3072, "13": 512 },
            "internalSources": { "temp": 1450, "vrefint": 1210, "vbat": 3300 }
          },
          "pwm": { "defaultFrequencyHz": 1000, "pins": [0, 1, 13] },
          "serial": { "readBytes": [115, 105, 109] },
          "i2c": {
            "defaultReadByte": 0,
            "addresses": { "64": { "readBytes": [18, 52, 86, 120] } }
          },
          "spi": {
            "defaultReadByte": 0,
            "transfers": { "9F": [239, 64, 22] }
          }
        }
        """
        return try SimulatorScriptDevice(fixtureData: Data(fixture.utf8))
    }

    public func getBuffer() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return buffer
    }

    public func clearBuffer() {
        lock.lock()
        buffer.removeAll()
        lock.unlock()
    }

    public func loadBuffer(data: Data) {
        lock.lock()
        buffer = data
        lock.unlock()
    }

    public func sendPacket(_ data: Data) {
        lock.lock()
        buffer.append(data)
        lock.unlock()
    }

    public func sendCommand(_ command: Data, timeout: Int) -> Data? {
        do {
            return try handle(command: [UInt8](command))
        } catch {
            return Data([Self.statusError])
        }
    }

    public func transmitBuffer() {}

    private func handle(command: [UInt8]) throws -> Data {
        guard let opcode = command.first else {
            throw SimulatorScriptDeviceError.malformedCommand("empty command")
        }

        switch opcode {
        case 0x01:
            return Data([
                Self.statusOK,
                fixture.board.firmwareVersion.major,
                fixture.board.firmwareVersion.minor,
                fixture.board.firmwareVersion.patch
            ])
        case 0x02:
            return ok()
        case 0x04:
            return ok(text: fixture.board.name)
        case 0x09:
            return ok(text: fixture.board.type)
        case 0x10:
            return try handleGpio(command)
        case 0x20:
            return try handleAdc(command)
        case 0x30:
            return try handleUart(command)
        case 0x40:
            return try handleI2c(command)
        case 0x50:
            return handleSpi(command)
        case 0x70:
            return try handlePwm(command)
        default:
            throw SimulatorScriptDeviceError.unsupportedOpcode(opcode)
        }
    }

    private func handleGpio(_ command: [UInt8]) throws -> Data {
        let subcommand = try byte(command, at: 1, message: "gpio subcommand missing")
        let pin = try byte(command, at: 2, message: "gpio pin missing")
        try requirePin(pin)

        lock.lock()
        defer { lock.unlock() }

        switch subcommand {
        case 0x00:
            gpioModes[pin] = "input"
            return ok()
        case 0x01:
            gpioModes[pin] = "output"
            return ok()
        case 0x02:
            return Data([Self.statusOK, gpioLevels[pin] ?? 0])
        case 0x03:
            gpioLevels[pin] = 1
            return ok()
        case 0x04:
            gpioLevels[pin] = 0
            return ok()
        case 0x05, 0x06:
            return ok()
        default:
            throw SimulatorScriptDeviceError.unsupportedSubcommand("gpio", subcommand)
        }
    }

    private func handleAdc(_ command: [UInt8]) throws -> Data {
        let source = try byte(command, at: 1, message: "adc source missing")
        let pin = command.count > 2 ? command[2] : 0
        let value: UInt16

        switch source {
        case 0x00:
            try requirePin(pin)
            value = fixture.adc.pinValues[String(pin)] ?? 0
        case 0x01:
            value = fixture.adc.internalSources["temp"] ?? 0
        case 0x02:
            value = fixture.adc.internalSources["vrefint"] ?? 0
        case 0x03:
            value = fixture.adc.internalSources["vbat"] ?? 0
        default:
            throw SimulatorScriptDeviceError.unsupportedSubcommand("adc", source)
        }

        return Data([Self.statusOK, UInt8(value & 0xff), UInt8((value >> 8) & 0xff)])
    }

    private func handleUart(_ command: [UInt8]) throws -> Data {
        let subcommand = try byte(command, at: 1, message: "uart subcommand missing")
        switch subcommand {
        case 0x00, 0x01:
            return ok()
        case 0x02:
            return Data([Self.statusOK, command.count > 8 ? command[8] : 0])
        case 0x03:
            let length = min(Int(command.count > 8 ? command[8] : 0), 63)
            let bytes = Array(fixture.serial.readBytes.prefix(length))
            return Data([Self.statusOK, UInt8(bytes.count)] + bytes)
        default:
            throw SimulatorScriptDeviceError.unsupportedSubcommand("uart", subcommand)
        }
    }

    private func handleI2c(_ command: [UInt8]) throws -> Data {
        let subcommand = try byte(command, at: 1, message: "i2c subcommand missing")
        switch subcommand {
        case 0x00, 0x01, 0x02:
            return ok()
        case 0x03, 0x04:
            let addr = command.count > 8 ? (command[8] & 0x7f) : 0
            let lengthIndex = subcommand == 0x03 ? 9 : 10
            let length = min(Int(command.count > lengthIndex ? command[lengthIndex] : 0), 63)
            let configured = fixture.i2c.addresses[String(addr)]?.readBytes ?? []
            return Data([Self.statusOK] + repeatedReply(configured, fill: fixture.i2c.defaultReadByte, count: length))
        default:
            throw SimulatorScriptDeviceError.unsupportedSubcommand("i2c", subcommand)
        }
    }

    private func handleSpi(_ command: [UInt8]) -> Data {
        let rxLength = min(Int(command.count > 2 ? command[2] : 0), 62)
        let txLength = min(Int(command.count > 3 ? command[3] : 0), max(0, command.count - 4))
        let tx = txLength > 0 ? Array(command[4..<(4 + txLength)]) : []
        let wanted = rxLength > 0 ? rxLength : txLength
        let configured = fixture.spi.transfers[hexKey(tx)] ?? []

        if configured.isEmpty && rxLength == 0 {
            return Data([Self.statusOK] + tx)
        }
        return Data([Self.statusOK] + repeatedReply(configured, fill: fixture.spi.defaultReadByte, count: wanted))
    }

    private func handlePwm(_ command: [UInt8]) throws -> Data {
        let subcommand = try byte(command, at: 1, message: "pwm subcommand missing")
        let pin = try byte(command, at: 2, message: "pwm pin missing")
        try requirePin(pin)
        guard pwmPins.contains(pin) else {
            throw SimulatorScriptDeviceError.unsupportedPwmPin(pin)
        }

        switch subcommand {
        case 0x00, 0x01, 0x02:
            return ok()
        default:
            throw SimulatorScriptDeviceError.unsupportedSubcommand("pwm", subcommand)
        }
    }

    private func requirePin(_ pin: UInt8) throws {
        guard pins.contains(pin) else {
            throw SimulatorScriptDeviceError.unknownPin(pin)
        }
    }

    private func byte(_ command: [UInt8], at index: Int, message: String) throws -> UInt8 {
        guard command.count > index else {
            throw SimulatorScriptDeviceError.malformedCommand(message)
        }
        return command[index]
    }

    private func ok() -> Data {
        Data([Self.statusOK])
    }

    private func ok(text: String) -> Data {
        Data([Self.statusOK] + Array(text.utf8))
    }

    private func repeatedReply(_ configured: [UInt8], fill: UInt8, count: Int) -> [UInt8] {
        guard count > 0 else { return [] }
        return (0..<count).map { index in
            index < configured.count ? configured[index] : fill
        }
    }

    private func hexKey(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02X", $0) }.joined()
    }
}

private struct SimulatorFixture: Decodable {
    let board: SimulatorBoardFixture
    let gpio: SimulatorGpioFixture
    let adc: SimulatorAdcFixture
    let pwm: SimulatorPwmFixture
    let serial: SimulatorSerialFixture
    let i2c: SimulatorI2cFixture
    let spi: SimulatorSpiFixture
}

private struct SimulatorBoardFixture: Decodable {
    let type: String
    let name: String
    let firmwareVersion: SimulatorFirmwareVersion
    let hardwareUid: String
    let protocolVersion: UInt8
}

private struct SimulatorFirmwareVersion: Decodable {
    let major: UInt8
    let minor: UInt8
    let patch: UInt8
}

private struct SimulatorGpioFixture: Decodable {
    let pins: [SimulatorGpioPinFixture]
}

private struct SimulatorGpioPinFixture: Decodable {
    let number: UInt8
    let name: String
    let modes: [String]
    let initialLevel: UInt8
}

private struct SimulatorAdcFixture: Decodable {
    let pinValues: [String: UInt16]
    let internalSources: [String: UInt16]
}

private struct SimulatorPwmFixture: Decodable {
    let defaultFrequencyHz: UInt32
    let pins: [UInt8]
}

private struct SimulatorSerialFixture: Decodable {
    let readBytes: [UInt8]
}

private struct SimulatorI2cFixture: Decodable {
    let defaultReadByte: UInt8
    let addresses: [String: SimulatorI2cAddressFixture]
}

private struct SimulatorI2cAddressFixture: Decodable {
    let readBytes: [UInt8]
}

private struct SimulatorSpiFixture: Decodable {
    let defaultReadByte: UInt8
    let transfers: [String: [UInt8]]
}
