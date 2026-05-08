import XCTest
@testable import EMWaver

@MainActor
final class IOSTargetedScriptDeviceTests: XCTestCase {
    func testRoutesScriptIoThroughCapturedDeviceId() {
        let base = FakeTargetedScriptDeviceBase()
        let device = IOSTargetedScriptDevice(base: base, deviceId: " USB:Board-1 ")
        let payload = Data([0x01, 0x02])

        device.sendPacket(payload)
        let response = device.sendCommand(payload, timeout: 500)
        device.transmitBuffer()
        device.clearBuffer()
        device.loadBuffer(data: payload)
        _ = device.getBuffer()

        XCTAssertEqual(base.lastSendPacketDeviceId, "USB:Board-1")
        XCTAssertEqual(base.lastSendCommandDeviceId, "USB:Board-1")
        XCTAssertEqual(base.lastTransmitDeviceId, "USB:Board-1")
        XCTAssertEqual(base.lastClearDeviceId, "USB:Board-1")
        XCTAssertEqual(base.lastLoadDeviceId, "USB:Board-1")
        XCTAssertEqual(base.lastGetDeviceId, "USB:Board-1")
        XCTAssertEqual(response, Data([0x7F]))
    }

    func testRoutesBlankCapturedDeviceIdAsActive() {
        let base = FakeTargetedScriptDeviceBase()
        let device = IOSTargetedScriptDevice(base: base, deviceId: "   ")

        device.sendPacket(Data([0x01]))

        XCTAssertEqual(base.lastSendPacketDeviceId, "active")
    }
}

private final class FakeTargetedScriptDeviceBase: IOSTargetedScriptDeviceBase {
    var lastGetDeviceId: String?
    var lastClearDeviceId: String?
    var lastLoadDeviceId: String?
    var lastSendPacketDeviceId: String?
    var lastSendCommandDeviceId: String?
    var lastTransmitDeviceId: String?

    func currentScriptDeviceId() -> String {
        "USB:Board-1"
    }

    func getBuffer(deviceId: String) -> Data {
        lastGetDeviceId = deviceId
        return Data([0x01, 0x02])
    }

    func clearBuffer(deviceId: String) {
        lastClearDeviceId = deviceId
    }

    func loadBuffer(data: Data, deviceId: String) {
        lastLoadDeviceId = deviceId
    }

    func sendPacket(_ data: Data, deviceId: String) {
        lastSendPacketDeviceId = deviceId
    }

    func sendCommand(_ command: Data, timeout: Int, deviceId: String) -> Data? {
        lastSendCommandDeviceId = deviceId
        return Data([0x7F])
    }

    func transmitBuffer(deviceId: String) {
        lastTransmitDeviceId = deviceId
    }
}
