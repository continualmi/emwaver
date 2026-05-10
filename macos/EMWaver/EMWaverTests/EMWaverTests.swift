//
//  EMWaverTests.swift
//  EMWaverTests
//
//  Created by Luís Lopes on 1/29/26.
//

import Testing
import Foundation
import EMWaverTransport
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

    @Test func wifiManualPortRequiresValidTcpPort() {
        #expect(DeviceConnectionSheet.parsedWiFiPort("3922") == 3922)
        #expect(DeviceConnectionSheet.parsedWiFiPort(" 443 ") == 443)
        #expect(DeviceConnectionSheet.parsedWiFiPort("0") == nil)
        #expect(DeviceConnectionSheet.parsedWiFiPort("65536") == nil)
        #expect(DeviceConnectionSheet.parsedWiFiPort("abc") == nil)
        #expect(DeviceConnectionSheet.parsedWiFiPort("3922/tcp") == nil)
    }

    @Test func wifiWebSocketURLBracketsIPv6Literals() throws {
        let url = try #require(MacWiFiManager.webSocketURL(host: "2001:db8::44", port: 3922))
        #expect(url.absoluteString == "ws://[2001:db8::44]:3922/v1/ws")
    }

    @Test func wifiWebSocketURLKeepsHostnamesUnbracketed() throws {
        let url = try #require(MacWiFiManager.webSocketURL(host: "emwaver-a1b2.local", port: 3922))
        #expect(url.absoluteString == "ws://emwaver-a1b2.local:3922/v1/ws")
    }

    @Test func wifiHardwareUIDParsesCommandResponse() {
        let response = Data([0x80, 0xd8, 0x3b, 0xda, 0xa4, 0xec, 0x7c, 0x00, 0x00])
        #expect(MacWiFiManager.hardwareUID(from: response) == "d83bdaa4ec7c")
        #expect(MacWiFiManager.hardwareUID(from: Data([0x80, 0, 0, 0, 0, 0, 0])) == nil)
        #expect(MacWiFiManager.hardwareUID(from: Data([0x80, 0x01, 0, 0, 0, 0, 0])) == nil)
        #expect(MacWiFiManager.hardwareUID(from: Data([0x81, 0xd8, 0x3b, 0xda, 0xa4, 0xec, 0x7c])) == nil)
    }

    @Test func wifiHardwareUIDProbeUsesPlainSysexPayload() throws {
        let sysex = try #require(MacWiFiManager.hardwareUIDCommandSysex())
        #expect(sysex.count == 48)
        let superframe = try #require(UsbMidiSysex.decodeSysexToSuperframe(sysex))
        #expect(superframe.count == 36)
        #expect(superframe[0] == 0x08)
    }

    @Test func wifiHardwareUIDParsesSysexCommandResponse() throws {
        var superframe = Data(repeating: 0, count: 36)
        superframe.replaceSubrange(0..<7, with: Data([0x80, 0xd8, 0x3b, 0xda, 0xa4, 0xec, 0x7c]))
        let sysex = try #require(UsbMidiSysex.encodeSuperframe(superframe))
        #expect(MacWiFiManager.hardwareUID(from: sysex) == "d83bdaa4ec7c")
    }

    @Test func wifiCommandLaneDetectionUsesPlainSysex() throws {
        var commandSuperframe = Data(repeating: 0, count: 36)
        commandSuperframe[0] = 0x80
        let commandSysex = try #require(UsbMidiSysex.encodeSuperframe(commandSuperframe))
        #expect(MacWiFiManager.hasCommandLane(commandSysex))

        var streamSuperframe = Data(repeating: 0, count: 36)
        streamSuperframe[18] = 0x42
        streamSuperframe[19] = 0x53
        let streamSysex = try #require(UsbMidiSysex.encodeSuperframe(streamSuperframe))
        #expect(!MacWiFiManager.hasCommandLane(streamSysex))
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

    @Test func wifiStatusParsesOptionalStationIP() {
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0])) == nil)
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0, 1, 10, 0, 0, 8])) == "10.0.0.8")
        #expect(MacUSBManager.wiFiStatusStationIP(Data([0x80, 1, 0, 1, 0, 0, 0, 0, 10, 0, 0, 8])) == nil)
    }

    @Test func wifiStatusParsesRuntimeState() {
        #expect(MacUSBManager.wiFiStatusRuntimeText(Data([0x80, 1, 0, 1, 0, 0, 0, 1, 10, 0, 0, 8])) == "idle")
        #expect(MacUSBManager.wiFiStatusRuntimeText(Data([0x80, 1, 0, 1, 0, 0, 0, 1, 10, 0, 0, 8, 0])) == "idle")
        #expect(MacUSBManager.wiFiStatusRuntimeText(Data([0x80, 1, 0, 1, 0, 0, 0, 1, 10, 0, 0, 8, 1])) == "running")
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

    @Test func wifiConnectionStateDistinguishesPairedOfflineFallbacks() {
        #expect(MacUSBManager.wiFiConnectionState(isActive: true, isConnected: true, isConnecting: false) == .connected)
        #expect(MacUSBManager.wiFiConnectionState(isActive: false, isConnected: true, isConnecting: false) == .connected)
        #expect(MacUSBManager.wiFiConnectionState(isActive: false, isConnected: false, isConnecting: true) == .connecting)
        #expect(MacUSBManager.wiFiConnectionState(isActive: false, isConnected: false, isConnecting: false) == .discovered)
    }

}
