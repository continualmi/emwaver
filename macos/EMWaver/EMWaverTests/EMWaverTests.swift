//
//  EMWaverTests.swift
//  EMWaverTests
//
//  Created by Luís Lopes on 1/29/26.
//

import Testing
import Foundation
@testable import EMWaver

struct EMWaverTests {

    @Test func wifiManualHostAcceptsHostnamesIPv4AndIPv6() {
        #expect(MacWiFiManager.isValidManualHost("emwaver-a1b2.local"))
        #expect(MacWiFiManager.isValidManualHost("192.168.1.44"))
        #expect(MacWiFiManager.isValidManualHost("2001:db8::44"))
    }

    @Test func wifiManualHostRejectsSchemesPortsAndPaths() {
        #expect(!MacWiFiManager.isValidManualHost("ws://192.168.1.44"))
        #expect(!MacWiFiManager.isValidManualHost("192.168.1.44:3922"))
        #expect(!MacWiFiManager.isValidManualHost("emwaver.local/v1/ws"))
        #expect(!MacWiFiManager.isValidManualHost("emwaver local"))
        #expect(!MacWiFiManager.isValidManualHost("[2001:db8::44]"))
    }

    @Test func wifiWebSocketURLBracketsIPv6Literals() throws {
        let url = try #require(MacWiFiManager.webSocketURL(host: "2001:db8::44", port: 3922))
        #expect(url.absoluteString == "ws://[2001:db8::44]:3922/v1/ws")
    }

    @Test func wifiWebSocketURLKeepsHostnamesUnbracketed() throws {
        let url = try #require(MacWiFiManager.webSocketURL(host: "emwaver-a1b2.local", port: 3922))
        #expect(url.absoluteString == "ws://emwaver-a1b2.local:3922/v1/ws")
    }

    @Test func wifiCommandSequenceSkipsReservedZeroAfterWrap() {
        #expect(MacWiFiManager.nextWiFiSequence(after: 1) == 2)
        #expect(MacWiFiManager.nextWiFiSequence(after: UInt16.max) == 1)
    }

}
