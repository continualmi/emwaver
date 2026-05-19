/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

@testable import EMWaverScriptRuntime
import XCTest

final class SimulatorScriptDeviceTests: XCTestCase {
    func testSharedBasicBoardFixtureDrivesProtocolCommands() throws {
        let device = try SimulatorScriptDevice(fixtureURL: fixtureURL())

        XCTAssertEqual(try textReply(device.sendCommand(Data([0x09]), timeout: 1500)), "emwaver-sim")
        XCTAssertEqual(device.sendCommand(Data([0x20, 0x00, 0x00]), timeout: 1500), Data([0x80, 0x00, 0x08]))
        XCTAssertEqual(device.sendCommand(Data([0x10, 0x01, 0x0d]), timeout: 1500), Data([0x80]))
        XCTAssertEqual(device.sendCommand(Data([0x10, 0x03, 0x0d]), timeout: 1500), Data([0x80]))
        XCTAssertEqual(device.sendCommand(Data([0x10, 0x02, 0x0d]), timeout: 1500), Data([0x80, 0x01]))
    }

    private func fixtureURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("simulator/fixtures/basic-board.json")
    }

    private func textReply(_ response: Data?) throws -> String {
        let response = try XCTUnwrap(response)
        XCTAssertEqual(response.first, 0x80)
        return String(data: response.dropFirst(), encoding: .utf8) ?? ""
    }
}
