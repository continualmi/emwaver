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

    @Test func wifiEnvelopeRoundTripsSequenceAndPayload() throws {
        let payload = Data([0xf0, 0x7d, 0x45, 0x4d, 0x57, 0xf7])
        let frame = try #require(MacWiFiManager.makeEnvelope(kind: 1, sequence: 42, payload: payload))
        let envelope = try #require(MacWiFiManager.unwrapEnvelope(frame))
        #expect(envelope.sequence == 42)
        #expect(envelope.payload == payload)
    }

    @Test func wifiEnvelopeRejectsOversizedPayloads() {
        let payload = Data(repeating: 0, count: Int(UInt16.max) + 1)
        #expect(MacWiFiManager.makeEnvelope(kind: 1, sequence: 42, payload: payload) == nil)
    }

    @Test func wifiEnvelopeRejectsLengthMismatch() throws {
        let payload = Data([0xf0, 0x7d, 0xf7])
        var frame = try #require(MacWiFiManager.makeEnvelope(kind: 1, sequence: 42, payload: payload))
        frame[8] = UInt8(payload.count + 1)
        #expect(MacWiFiManager.unwrapEnvelope(frame) == nil)
    }

    @Test func wifiBufferStatusLaneRequiresExactPaddedStatusShape() {
        var status = Data(repeating: 0, count: 18)
        status[0] = 0x42
        status[1] = 0x53
        status[2] = 0x12
        status[3] = 0x34

        #expect(MacUSBManager.isBufferStatusLane(status))
        #expect(!MacUSBManager.isBufferStatusLane(Data("BSdata".utf8)))

        var streamData = Data(repeating: 0, count: 18)
        streamData[0] = 0x42
        streamData[1] = 0x53
        streamData[2] = 0x12
        streamData[3] = 0x34
        streamData[4] = 0x56
        #expect(!MacUSBManager.isBufferStatusLane(streamData))
    }

    @Test func wifiOutgoingSequenceZeroIsReservedForStreamOnlySuperframes() {
        var streamOnly = Data(repeating: 0, count: 36)
        streamOnly[18] = 0x01
        #expect(MacUSBManager.wiFiSequenceForOutgoingSuperframe(streamOnly) == 0)

        var commandOnly = Data(repeating: 0, count: 36)
        commandOnly[0] = 0x01
        #expect(MacUSBManager.wiFiSequenceForOutgoingSuperframe(commandOnly) == nil)

        var mixed = commandOnly
        mixed[18] = 0x02
        #expect(MacUSBManager.wiFiSequenceForOutgoingSuperframe(mixed) == nil)

        #expect(MacUSBManager.wiFiSequenceForOutgoingSuperframe(Data(repeating: 0, count: 36)) == nil)
    }

    @Test func wifiGeneratedHostnameUsesSafeAsciiSuffix() {
        #expect(MacUSBManager.generatedWiFiHostname(randomSuffix: "ABC-123_xyz") == "emwaver-abc123xy")
        #expect(MacUSBManager.generatedWiFiHostname(randomSuffix: "-_") == "emwaver-local")
        #expect(MacUSBManager.isValidWiFiHostname(MacUSBManager.generatedWiFiHostname(randomSuffix: "ABC-123_xyz")))
    }

    @Test func wifiProvisioningHostnameRejectsMalformedLocalNames() {
        #expect(MacUSBManager.isValidWiFiHostname(""))
        #expect(MacUSBManager.isValidWiFiHostname("emwaver-a1b2"))
        #expect(!MacUSBManager.isValidWiFiHostname("-emwaver"))
        #expect(!MacUSBManager.isValidWiFiHostname("emwaver-"))
        #expect(!MacUSBManager.isValidWiFiHostname("emwaver.local"))
        #expect(!MacUSBManager.isValidWiFiHostname("emwaver local"))
    }

    @Test func wifiStatusParsesOptionalStationIP() {
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0])) == nil)
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0, 1, 10, 0, 0, 8])) == "10.0.0.8")
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0, 0, 10, 0, 0, 8])) == nil)
    }

    @Test func wifiBoardMetadataNormalizesEspTargets() {
        #expect(MacWiFiManager.normalizedBoardType("esp32-s3") == "esp32s3")
        #expect(MacWiFiManager.normalizedBoardType("ESP32S2") == "esp32s2")
        #expect(MacWiFiManager.normalizedBoardType("esp32") == "esp32")
        #expect(MacWiFiManager.normalizedBoardType("custom-board") == "custom-board")
        #expect(MacWiFiManager.normalizedBoardType("   ") == nil)
    }

    @Test func firmwareUpdaterTreatsAllEspBoardTypesAsEspWorkflow() {
        #expect(FirmwareUpdateManager.isEspBoardType("esp32"))
        #expect(FirmwareUpdateManager.isEspBoardType(" ESP32-S2 "))
        #expect(FirmwareUpdateManager.isEspBoardType("esp32s3"))
        #expect(!FirmwareUpdateManager.isEspBoardType("stm32f042"))
        #expect(!FirmwareUpdateManager.isEspBoardType(nil))
    }

    @Test func firmwareUpdaterNormalizesEspBoardTypes() {
        #expect(FirmwareUpdateManager.normalizedEspBoardType("esp32") == "esp32")
        #expect(FirmwareUpdateManager.normalizedEspBoardType(" ESP32-S2 ") == "esp32s2")
        #expect(FirmwareUpdateManager.normalizedEspBoardType("esp32-s3") == "esp32s3")
        #expect(FirmwareUpdateManager.normalizedEspBoardType("stm32f042") == nil)
    }

    @Test func wifiCapabilitiesParseAdvertisedTxtList() {
        #expect(MacWiFiManager.capabilities("wifi,usb,ble") == ["wifi", "usb", "ble"])
        #expect(MacWiFiManager.capabilities(" WiFi, USB ") == ["wifi", "usb"])
        #expect(MacWiFiManager.capabilities("wifi,,ble") == ["wifi", "ble"])
        #expect(MacWiFiManager.capabilities(nil).isEmpty)
    }

    @Test func wifiCapabilityCheckToleratesCaseAndWhitespace() {
        #expect(MacWiFiManager.advertisesWiFiCapability([" WiFi ", "USB"]))
        #expect(!MacWiFiManager.advertisesWiFiCapability(["usb", "ble"]))
    }

    @Test func wifiChallengeParserAcceptsChallengeJsonOnly() {
        #expect(MacWiFiManager.challengeValue(from: #"{"type":"challenge","challenge":"abc123"}"#) == "abc123")
        #expect(MacWiFiManager.challengeValue(from: #"{"type":"auth","challenge":"abc123"}"#) == nil)
        #expect(MacWiFiManager.challengeValue(from: #"{"type":"challenge","challenge":"   "}"#) == nil)
        #expect(MacWiFiManager.challengeValue(from: "auth ok") == nil)
    }

}
