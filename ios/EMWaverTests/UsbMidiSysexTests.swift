import XCTest
@testable import EMWaver

final class UsbMidiSysexTests: XCTestCase {
    func testEncodeZerosIsExpected() {
        let pkt = Data(repeating: 0x00, count: 64)
        guard let sysex = UsbMidiSysex.encodePacket64(pkt) else {
            return XCTFail("encodePacket64 returned nil")
        }

        XCTAssertEqual(sysex.count, 81)
        XCTAssertEqual(Array(sysex.prefix(6)), [0xF0, 0x7D, 0x45, 0x4D, 0x57, 0x01])
        XCTAssertEqual(sysex.last, 0xF7)

        let payload = [UInt8](sysex[6..<(sysex.count - 1)])
        XCTAssertEqual(payload.count, 74)
        XCTAssertTrue(payload.allSatisfy { $0 == 0x00 })

        XCTAssertEqual(UsbMidiSysex.decodeSysexToPacket64(sysex), pkt)
    }

    func testEncodeSetsPrefixBitsForHighBytes() {
        var pkt = Data(repeating: 0x00, count: 64)
        pkt[0] = 0x80
        pkt[2] = 0xFF
        pkt[6] = 0x81

        guard let sysex = UsbMidiSysex.encodePacket64(pkt) else {
            return XCTFail("encodePacket64 returned nil")
        }

        let payload = [UInt8](sysex[6..<(sysex.count - 1)])
        // First group is prefix + 7 bytes.
        // High bits set for indices 0,2,6 => prefix bits 0,2,6 => 0b0100_0101 = 0x45
        XCTAssertEqual(payload[0], 0x45)
        XCTAssertEqual(payload[1], 0x00) // 0x80 -> 0x00
        XCTAssertEqual(payload[3], 0x7F) // 0xFF -> 0x7F
        XCTAssertEqual(payload[7], 0x01) // 0x81 -> 0x01

        XCTAssertEqual(UsbMidiSysex.decodeSysexToPacket64(sysex), pkt)
    }

    func testDecodeRejectsWrongHeader() {
        let pkt = Data(repeating: 0x00, count: 64)
        let sysex = UsbMidiSysex.encodePacket64(pkt)!

        var broken = [UInt8](sysex)
        broken[2] = 0x00
        XCTAssertNil(UsbMidiSysex.decodeSysexToPacket64(Data(broken)))
    }
}
