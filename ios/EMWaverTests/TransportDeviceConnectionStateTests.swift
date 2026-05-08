import XCTest
@testable import EMWaver

final class TransportDeviceConnectionStateTests: XCTestCase {
    private enum Transport {
        case none
        case usb
        case ble
    }

    func testCurrentScriptDeviceIdFollowsActiveConnectionWhenPresent() {
        let state = TransportDeviceConnectionState(noneTransport: Transport.none)
        let target = state.setTarget(deviceId: " usb:target ", transport: .usb)
        let connection = FakeConnection(sessionKey: "usb:connection", displayName: "USB Board")

        state.setConnection(connection)

        XCTAssertEqual(target.deviceId, "usb:target")
        XCTAssertEqual(state.currentScriptDeviceId, "usb:connection")
        XCTAssertEqual(state.connection?.sessionKey, connection.sessionKey)
        XCTAssertTrue(state.matchesDeviceId("USB:TARGET"))
        XCTAssertTrue(state.matchesTransport(.usb))
    }

    func testClearingMatchingTransportDropsConnectionAndResetsTarget() {
        let state = TransportDeviceConnectionState(noneTransport: Transport.none)
        state.setTarget(deviceId: "ble:board", transport: .ble)
        state.setConnection(FakeConnection(sessionKey: "ble:board", displayName: "BLE Board"))

        state.clear(transport: .usb)
        XCTAssertEqual(state.currentScriptDeviceId, "ble:board")

        state.clear(transport: .ble)
        XCTAssertEqual(state.currentScriptDeviceId, "active")
        XCTAssertEqual(state.transport, .none)
        XCTAssertFalse(state.matchesDeviceId("ble:board"))
    }

    private final class FakeConnection: TransportDeviceConnection {
        let sessionKey: String
        let displayName: String
        let session: TransportDeviceSession

        init(sessionKey: String, displayName: String) {
            self.sessionKey = sessionKey
            self.displayName = displayName
            self.session = DeviceBufferSession()
        }
    }
}
