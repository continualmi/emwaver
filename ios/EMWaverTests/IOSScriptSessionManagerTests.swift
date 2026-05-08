import XCTest
import EMWaverScriptsUI
@testable import EMWaver

@MainActor
final class IOSScriptSessionManagerTests: XCTestCase {
    func testKeepsMultipleVisibleSessionRowsAndStopsIndividually() {
        let manager = IOSScriptSessionManager()
        let device = FakeScriptSessionDevice(deviceId: "active")

        let first = manager.run(
            scriptRequest(id: "script-a", name: "Alpha"),
            device: device,
            deviceLabel: "USB A"
        )
        let second = manager.run(
            scriptRequest(id: "script-b", name: "Beta"),
            device: device,
            deviceLabel: "USB B"
        )

        XCTAssertNotNil(first)
        XCTAssertNotNil(second)
        XCTAssertEqual(manager.sessionStatuses.count, 2)
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.scriptId)), ["script-a", "script-b"])
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.deviceLabel)), ["USB A", "USB B"])
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.deviceId)), ["active"])
        XCTAssertEqual(manager.sessionDeviceId(first!.scriptInstanceId), "active")
        XCTAssertEqual(manager.sessionDeviceId(second!.scriptInstanceId), "active")

        manager.stopSession(first!.scriptInstanceId)

        XCTAssertEqual(manager.sessionStatuses.count, 1)
        XCTAssertEqual(manager.sessionDeviceId(first!.scriptInstanceId), nil)
        XCTAssertEqual(manager.sessionStatuses.first?.scriptId, "script-b")
        XCTAssertTrue(manager.hasRunningSessions)
        XCTAssertEqual(manager.activeScriptName, "Beta")
    }

    func testCapturesDistinctDeviceIdsPerSession() {
        let manager = IOSScriptSessionManager()
        let device = FakeScriptSessionDevice(deviceId: "usbmidi:board-a")

        let first = manager.run(
            scriptRequest(id: "script-a", name: "Alpha"),
            device: device,
            deviceLabel: "USB A"
        )

        device.deviceId = "ble:board-b"
        let second = manager.run(
            scriptRequest(id: "script-b", name: "Beta"),
            device: device,
            deviceLabel: "BLE B"
        )

        XCTAssertNotNil(first)
        XCTAssertNotNil(second)
        XCTAssertEqual(manager.sessionDeviceId(first!.scriptInstanceId), "usbmidi:board-a")
        XCTAssertEqual(manager.sessionDeviceId(second!.scriptInstanceId), "ble:board-b")
        XCTAssertEqual(Set(manager.sessionStatuses.map(\.deviceId)), ["usbmidi:board-a", "ble:board-b"])
    }

    func testCapturesBlankDeviceIdAsActive() {
        let manager = IOSScriptSessionManager()
        let device = FakeScriptSessionDevice(deviceId: "   ")

        let result = manager.run(
            scriptRequest(id: "script-a", name: "Alpha"),
            device: device,
            deviceLabel: "Active Device"
        )

        XCTAssertNotNil(result)
        XCTAssertEqual(manager.sessionDeviceId(result!.scriptInstanceId), "active")
        XCTAssertEqual(manager.sessionStatuses.first?.deviceId, "active")
    }

    private func scriptRequest(id: String, name: String) -> ScriptsRootView.ScriptRunRequest {
        ScriptsRootView.ScriptRunRequest(
            scriptId: id,
            name: name,
            source: """
            UI.render(UI.text({ text: "\(name)" }));
            """,
            moduleSources: [:]
        )
    }
}

private final class FakeScriptSessionDevice: IOSTargetedScriptDeviceBase {
    var deviceId: String

    init(deviceId: String) {
        self.deviceId = deviceId
    }

    func currentScriptDeviceId() -> String {
        deviceId
    }

    func getBuffer(deviceId: String) -> Data {
        Data()
    }

    func clearBuffer(deviceId: String) {}

    func loadBuffer(data: Data, deviceId: String) {}

    func sendPacket(_ data: Data, deviceId: String) {}

    func sendCommand(_ command: Data, timeout: Int, deviceId: String) -> Data? {
        nil
    }

    func transmitBuffer(deviceId: String) {}
}
