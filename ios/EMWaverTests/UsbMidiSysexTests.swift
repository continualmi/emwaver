import XCTest
@testable import EMWaver

final class UsbMidiSysexTests: XCTestCase {
    func testEncodeZerosIsExpected() {
        let pkt = Data(repeating: 0x00, count: 128)
        guard let sysex = UsbMidiSysex.encodeSuperframe(pkt) else {
            return XCTFail("encodeSuperframe returned nil")
        }

        // 6 header + 147 payload + 1 footer = 154
        XCTAssertEqual(sysex.count, 154)
        XCTAssertEqual(Array(sysex.prefix(6)), [0xF0, 0x7D, 0x45, 0x4D, 0x57, 0x01])
        XCTAssertEqual(sysex.last, 0xF7)

        let payload = [UInt8](sysex[6..<(sysex.count - 1)])
        XCTAssertEqual(payload.count, 147)
        XCTAssertTrue(payload.allSatisfy { $0 == 0x00 })

        XCTAssertEqual(UsbMidiSysex.decodeSysexToSuperframe(sysex), pkt)
    }

    func testEncodeSetsPrefixBitsForHighBytes() {
        var pkt = Data(repeating: 0x00, count: 128)
        pkt[0] = 0x80
        pkt[2] = 0xFF
        pkt[6] = 0x81
        // Test byte in the second lane (index 64)
        pkt[64] = 0x82

        guard let sysex = UsbMidiSysex.encodeSuperframe(pkt) else {
            return XCTFail("encodeSuperframe returned nil")
        }

        let payload = [UInt8](sysex[6..<(sysex.count - 1)])
        // First group is prefix + 7 bytes.
        // High bits set for indices 0,2,6 => prefix bits 0,2,6 => 0b0100_0101 = 0x45
        XCTAssertEqual(payload[0], 0x45)
        XCTAssertEqual(payload[1], 0x00) // 0x80 -> 0x00
        XCTAssertEqual(payload[3], 0x7F) // 0xFF -> 0x7F
        XCTAssertEqual(payload[7], 0x01) // 0x81 -> 0x01

        // Byte 64 is in the 10th group (64 / 7 = 9 remainder 1).
        // Actually: 0..6 (group 0), 7..13 (group 1) ... 63..69 (group 9).
        // Index 64 is the 2nd byte of group 9 (index 1 in group).
        // Group 9 starts at payload index 9*8 = 72.
        // Prefix byte at 72.
        // Data bytes at 73..79.
        // Byte 64 is at 73 + 1 = 74.
        
        // Wait, 63 / 7 = 9. So 0..63 consumes 9 groups + 1 byte (start of group 9).
        // 0..6 (7 bytes) -> Group 0 (8 bytes)
        // ...
        // 56..62 (7 bytes) -> Group 8 (8 bytes) -> out index 64..71.
        // Byte 63 is start of Group 9.
        // Byte 64 is 2nd byte of Group 9.
        
        // Group 9 prefix is at payload index 72.
        // Byte 63 (0x00) -> bit 0 of prefix.
        // Byte 64 (0x82) -> bit 1 of prefix.
        // Prefix should have bit 1 set -> 0x02.
        
        XCTAssertEqual(payload[72], 0x02)
        XCTAssertEqual(payload[74], 0x02) // 0x82 -> 0x02

        XCTAssertEqual(UsbMidiSysex.decodeSysexToSuperframe(sysex), pkt)
    }

    func testDecodeRejectsWrongHeader() {
        let pkt = Data(repeating: 0x00, count: 128)
        let sysex = UsbMidiSysex.encodeSuperframe(pkt)!

        var broken = [UInt8](sysex)
        broken[2] = 0x00
        XCTAssertNil(UsbMidiSysex.decodeSysexToSuperframe(Data(broken)))
    }
}
