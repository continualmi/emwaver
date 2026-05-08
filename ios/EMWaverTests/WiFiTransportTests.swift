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

        XCTAssertEqual(first.hostOrDeviceId, "192.168.4.2")
        assertConnectionOwnsIsolatedSession(first, expectedSessionKey: "wifi:192.168.4.2", expectedDisplayName: "Wi-Fi: 192.168.4.2", isolatedFrom: second)
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
