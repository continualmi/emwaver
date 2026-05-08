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
}
