import XCTest
@testable import EMWaver

final class ActiveDeviceTargetTests: XCTestCase {
    private enum Transport {
        case none
        case usb
        case ble
    }

    func testNormalizesBlankDeviceIdToActive() {
        let target = ActiveDeviceTarget(deviceId: "   ", transport: Transport.none)

        XCTAssertEqual(target.deviceId, "active")
        XCTAssertTrue(target.matchesDeviceId(nil))
        XCTAssertTrue(target.matchesDeviceId(""))
    }

    func testMatchesExactTrimmedDeviceIdAndTransport() {
        let target = ActiveDeviceTarget(deviceId: " usb:board-1 ", transport: Transport.usb)

        XCTAssertEqual(target.deviceId, "usb:board-1")
        XCTAssertTrue(target.matchesDeviceId("usb:board-1"))
        XCTAssertFalse(target.matchesDeviceId("ble:board-1"))
        XCTAssertTrue(target.matchesTransport(.usb))
        XCTAssertFalse(target.matchesTransport(.ble))
    }
}
