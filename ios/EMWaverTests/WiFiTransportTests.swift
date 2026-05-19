import XCTest
@testable import EMWaver

final class WiFiTransportTests: XCTestCase {
    func testNormalizesSessionIdentityAndDisplayName() {
        XCTAssertEqual(WiFiTransport.sessionKey(for: nil), "wifi:active")
        XCTAssertEqual(WiFiTransport.displayName(for: nil), "Wi-Fi: device")

        XCTAssertEqual(WiFiTransport.sessionKey(for: " "), "wifi:active")
        XCTAssertEqual(WiFiTransport.displayName(for: " "), "Wi-Fi: device")

        XCTAssertEqual(WiFiTransport.sessionKey(for: " 192.168.4.2 "), "wifi:192.168.4.2")
        XCTAssertEqual(WiFiTransport.displayName(for: " 192.168.4.2 "), "Wi-Fi: 192.168.4.2")
    }

    func testConnectionOwnsTransportDeviceSession() {
        let first = WiFiTransport.Connection(hostOrDeviceId: " 192.168.4.2 ")
        let second = WiFiTransport.Connection(hostOrDeviceId: " 192.168.4.3 ")

        XCTAssertEqual(first.hostOrDeviceId, "192.168.4.2:3922")
        assertConnectionOwnsIsolatedSession(first, expectedSessionKey: "wifi:192.168.4.2:3922", expectedDisplayName: "Wi-Fi: 192.168.4.2:3922", isolatedFrom: second)
    }

    func testWebSocketURLValidatesManualLanHosts() {
        XCTAssertEqual(WiFiTransport.webSocketURL(host: "192.168.4.2", port: 3922)?.absoluteString, "ws://192.168.4.2:3922/v1/ws")
        XCTAssertEqual(WiFiTransport.webSocketURL(host: "emwaver-a1b2.local", port: 3922)?.absoluteString, "ws://emwaver-a1b2.local:3922/v1/ws")
        XCTAssertEqual(WiFiTransport.webSocketURL(host: "fd00::1234", port: 3922)?.absoluteString, "ws://[fd00::1234]:3922/v1/ws")
        XCTAssertNil(WiFiTransport.webSocketURL(host: "ws://192.168.4.2", port: 3922))
        XCTAssertNil(WiFiTransport.webSocketURL(host: "192.168.4.2/path", port: 3922))
        XCTAssertNil(WiFiTransport.webSocketURL(host: "[fd00::1234]", port: 3922))
        XCTAssertNil(WiFiTransport.webSocketURL(host: "192.168.4.2", port: 70000))
    }

    func testProvisioningCommandsChunkSsidAndPassword() throws {
        let commands = try XCTUnwrap(WiFiTransport.provisioningCommands(ssid: "bench-network", password: "password-with-more-than-13-bytes"))

        XCTAssertEqual(commands.first, Data([0x0A, 0x00]))
        XCTAssertEqual(commands.last, Data([0x0A, 0x02]))
        XCTAssertTrue(commands.contains { $0.prefix(5) == Data([0x0A, 0x01, 0x00, 0x00, 13]) })
        XCTAssertTrue(commands.contains { $0.prefix(5) == Data([0x0A, 0x01, 0x01, 0x00, 13]) })
        XCTAssertTrue(commands.contains { $0.prefix(4) == Data([0x0A, 0x01, 0x01, 13]) })
    }

    func testProvisioningCommandsRejectInvalidLengths() {
        XCTAssertNil(WiFiTransport.provisioningCommands(ssid: " ", password: "ok"))
        XCTAssertNil(WiFiTransport.provisioningCommands(ssid: String(repeating: "s", count: 33), password: "ok"))
        XCTAssertNil(WiFiTransport.provisioningCommands(ssid: "ok", password: String(repeating: "p", count: 65)))
    }

    func testStatusMessageParsesStationIPAndRuntime() {
        let response = Data([0x80, 1, 0, 1, 0, 0, 0, 1, 192, 168, 4, 2, 1])

        XCTAssertEqual(
            WiFiTransport.statusMessage(from: response),
            "Wi-Fi is provisioned, station is online at 192.168.4.2 (idle, no disconnect reason); socket is idle; runtime is running."
        )
    }

    func testDiscoveredDeviceNormalizesBonjourRecord() throws {
        let device = try XCTUnwrap(WiFiTransport.discoveredDevice(
            name: "EMWaver-A1B2",
            domain: "local.",
            metadata: [
                "host": "emwaver-a1b2",
                "board": "esp32-s3",
                "fw": "1.2",
                "proto": "1",
                "cap": "wifi, gpio"
            ]
        ))

        XCTAssertEqual(device.id, "wifi:emwaver-a1b2.local:3922")
        XCTAssertEqual(device.displayName, "EMWaver-A1B2")
        XCTAssertEqual(device.host, "emwaver-a1b2.local")
        XCTAssertEqual(device.port, 3922)
        XCTAssertEqual(device.boardType, "esp32s3")
        XCTAssertEqual(device.firmwareVersion, "1.2")
        XCTAssertEqual(device.protocolVersion, "1")
        XCTAssertEqual(device.capabilities, ["wifi", "gpio"])
    }

    private func assertConnectionOwnsIsolatedSession(
        _ connection: TransportDeviceConnection,
        expectedSessionKey: String,
        expectedDisplayName: String,
        isolatedFrom other: TransportDeviceConnection
    ) {
        connection.session.appendTxBytes(Data([0x01]), tsMs: 1)

        XCTAssertEqual(connection.sessionKey, expectedSessionKey)
        XCTAssertEqual(connection.displayName, expectedDisplayName)
        XCTAssertEqual(connection.session.getTxPacketCount(), 1)
        XCTAssertEqual(other.session.getTxPacketCount(), 0)
    }
}
