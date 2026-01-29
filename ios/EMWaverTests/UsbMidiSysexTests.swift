import XCTest
@testable import EMWaver

final class UsbMidiSysexTests: XCTestCase {
    func testEncodeZerosIsExpected() {
        let pkt = Data(repeating: 0x00, count: 36)
        guard let sysex = UsbMidiSysex.encodeSuperframe(pkt) else {
            return XCTFail("encodeSuperframe returned nil")
        }

        // 5 header + 42 payload + 1 footer = 48
        XCTAssertEqual(sysex.count, 48)
        XCTAssertEqual(Array(sysex.prefix(5)), [0xF0, 0x7D, 0x45, 0x4D, 0x57])
        XCTAssertEqual(sysex.last, 0xF7)

        let payload = [UInt8](sysex[5..<(sysex.count - 1)])
        XCTAssertEqual(payload.count, 42)
        XCTAssertTrue(payload.allSatisfy { $0 == 0x00 })

        XCTAssertEqual(UsbMidiSysex.decodeSysexToSuperframe(sysex), pkt)
    }

    func testEncodeSetsPrefixBitsForHighBytes() {
        var pkt = Data(repeating: 0x00, count: 36)
        pkt[0] = 0x80
        pkt[2] = 0xFF
        pkt[6] = 0x81
        // Test byte in the second lane (index 18)
        pkt[18] = 0x82

        guard let sysex = UsbMidiSysex.encodeSuperframe(pkt) else {
            return XCTFail("encodeSuperframe returned nil")
        }

        let payload = [UInt8](sysex[5..<(sysex.count - 1)])
        // First group is prefix + 7 bytes.
        // High bits set for indices 0,2,6 => prefix bits 0,2,6 => 0b0100_0101 = 0x45
        XCTAssertEqual(payload[0], 0x45)
        XCTAssertEqual(payload[1], 0x00) // 0x80 -> 0x00
        XCTAssertEqual(payload[3], 0x7F) // 0xFF -> 0x7F
        XCTAssertEqual(payload[7], 0x01) // 0x81 -> 0x01

        // Byte 18 is in group 2 (18 / 7 = 2 remainder 4).
        // Group 2 prefix is at payload index 16 (2 * 8).
        // Within the group, byte 18 is index 4 (remainder), so data byte at 16 + 1 + 4 = 21.
        // Prefix should have bit 4 set -> 0x10.
        XCTAssertEqual(payload[16], 0x10)
        XCTAssertEqual(payload[21], 0x02) // 0x82 -> 0x02

        XCTAssertEqual(UsbMidiSysex.decodeSysexToSuperframe(sysex), pkt)
    }

    func testDecodeRejectsWrongHeader() {
        let pkt = Data(repeating: 0x00, count: 36)
        let sysex = UsbMidiSysex.encodeSuperframe(pkt)!

        var broken = [UInt8](sysex)
        broken[2] = 0x00
        XCTAssertNil(UsbMidiSysex.decodeSysexToSuperframe(Data(broken)))
    }
}
