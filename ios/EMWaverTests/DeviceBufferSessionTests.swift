import XCTest
@testable import EMWaver

final class DeviceBufferSessionTests: XCTestCase {
    func testSeparateSessionsKeepRxBuffersAndCountersIsolated() {
        let usb = DeviceBufferSession()
        let ble = DeviceBufferSession()

        let usbPacket = packet(0x11)
        let blePacket = packet(0x22)

        usb.storeBulkPkt(usbPacket, tsMs: 100)
        ble.storeBulkPkt(blePacket, tsMs: 200)

        XCTAssertEqual(usb.getRxPacketCount(), 1)
        XCTAssertEqual(ble.getRxPacketCount(), 1)
        XCTAssertEqual(usb.getBuffer(), usbPacket)
        XCTAssertEqual(ble.getBuffer(), blePacket)

        let usbNext = usb.nextRxPacket()
        XCTAssertEqual(usbNext?.packet64, usbPacket)
        XCTAssertNil(usb.nextRxPacket())

        let bleNext = ble.nextRxPacket()
        XCTAssertEqual(bleNext?.packet64, blePacket)
    }

    func testSeparateSessionsKeepSamplerStreamingStateIsolated() {
        let usb = DeviceBufferSession()
        let ble = DeviceBufferSession()

        _ = usb.outgoingSamplerPolicy(for: Data([0x60, 0x00]))

        let emptyLane = Data(repeating: 0x00, count: 18)
        let emptySuperframe = emptyLane + emptyLane
        guard let sysex = UsbMidiSysex.encodeSuperframe(emptySuperframe) else {
            return XCTFail("encodeSuperframe returned nil")
        }

        usb.feedMidiBytes(sysex, tsMs: 300)
        ble.feedMidiBytes(sysex, tsMs: 300)

        XCTAssertEqual(usb.getRxPacketCount(), 1)
        XCTAssertEqual(ble.getRxPacketCount(), 0)
    }

    func testSeparateSessionsKeepTxBuffersIsolated() {
        let usb = DeviceBufferSession()
        let ble = DeviceBufferSession()

        let usbPacket = packet(0x55)
        let blePacket = packet(0x66)

        usb.appendTxBytes(usbPacket, tsMs: 500)
        ble.appendTxBytes(blePacket, tsMs: 600)

        let usbTx = usb.readTxSince(packetIndex: 0, maxPackets: 8)
        let bleTx = ble.readTxSince(packetIndex: 0, maxPackets: 8)

        XCTAssertEqual(usb.getTxPacketCount(), 1)
        XCTAssertEqual(ble.getTxPacketCount(), 1)
        XCTAssertEqual(usbTx.data, Array(usbPacket))
        XCTAssertEqual(bleTx.data, Array(blePacket))
    }

    private func packet(_ value: UInt8) -> Data {
        Data(repeating: value, count: 18)
    }
}
