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
