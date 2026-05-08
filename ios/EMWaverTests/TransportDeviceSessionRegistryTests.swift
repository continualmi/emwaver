import XCTest
@testable import EMWaver

final class TransportDeviceSessionRegistryTests: XCTestCase {
    func testSelectWithoutResetPreservesExistingSessionBuffers() {
        let registry = TransportDeviceSessionRegistry()
        let usb = registry.select(deviceId: "usb:test", resetSession: true)
        let packet = packet(0x33)
        usb.storeBulkPkt(packet, tsMs: 100)

        let selected = registry.select(deviceId: "usb:test", resetSession: false)

        XCTAssertTrue(usb === selected)
        XCTAssertEqual(selected.getRxPacketCount(), 1)
        XCTAssertEqual(selected.getBuffer(), packet)
    }

    func testSelectWithResetClearsExistingSessionBuffers() {
        let registry = TransportDeviceSessionRegistry()
        let usb = registry.select(deviceId: "usb:test", resetSession: true)
        usb.storeBulkPkt(packet(0x44), tsMs: 100)

        let selected = registry.select(deviceId: "usb:test", resetSession: true)

        XCTAssertTrue(usb === selected)
        XCTAssertEqual(selected.getRxPacketCount(), 0)
        XCTAssertTrue(selected.getBuffer().isEmpty)
    }

    func testSeparateDeviceIdsResolveToSeparateSessions() {
        let registry = TransportDeviceSessionRegistry()

        let usb = registry.session(deviceId: "usb:test")
        let ble = registry.session(deviceId: "ble:test")

        XCTAssertFalse(usb === ble)
    }

    func testSessionIdsAreTrimmedAndCaseInsensitive() {
        let registry = TransportDeviceSessionRegistry()

        let original = registry.session(deviceId: " USB:Test ")
        let normalized = registry.session(deviceId: "usb:test")

        XCTAssertTrue(original === normalized)
    }

    private func packet(_ value: UInt8) -> Data {
        Data(repeating: value, count: 18)
    }
}
