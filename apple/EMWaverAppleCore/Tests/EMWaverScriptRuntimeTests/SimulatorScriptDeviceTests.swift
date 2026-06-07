/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import EMWaverScriptModel
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

    func testScriptEngineRunsHardwareScriptAgainstSharedSimulatorFixture() throws {
        let scripts = try defaultScriptSources()
        let device = try SimulatorScriptDevice(fixtureURL: fixtureURL())
        let engine = ScriptEngine()
        engine.setBootstrapSource(scripts["emw-kernel.emw"])

        let rendered = expectation(description: "script rendered")
        var errors: [String] = []
        var tree: ScriptTree?

        engine.setup(
            renderHandler: { next in
                tree = next
                rendered.fulfill()
            },
            bindings: ["Device": ScriptDeviceWrapper(device: device)],
            errorHandler: { message in
                errors.append(message)
            }
        )

        engine.execute(
            script: """
                import { JSX, render } from "emw-jsx";
                import { Column, Text } from "emw-ui";
                import { gpio } from "emw-gpio";
                import { adc } from "emw-adc";

                gpio.mode(13, "output");
                gpio.write(13, 1);
                var board = device.boardType({ refresh: true });
                var value = adc.read(0);
                render(
                  <Column>
                    <Text>{board}</Text>
                    <Text>{String(value)}</Text>
                  </Column>
                );
                """,
            moduleSources: scripts
        )

        wait(for: [rendered], timeout: 8)
        XCTAssertTrue(errors.isEmpty, errors.joined(separator: "\n"))
        let root = try XCTUnwrap(tree?.root)
        XCTAssertEqual(root.type, .column)
        XCTAssertTrue(root.children.contains { $0.props.text == "emwaver-sim" })
        XCTAssertTrue(root.children.contains { $0.props.text == "2048" })
    }

    private func fixtureURL() -> URL {
        repoRootURL()
            .appendingPathComponent("simulator/fixtures/basic-board.json")
    }

    private func repoRootURL() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private func textReply(_ response: Data?) throws -> String {
        let response = try XCTUnwrap(response)
        XCTAssertEqual(response.first, 0x80)
        return String(data: response.dropFirst(), encoding: .utf8) ?? ""
    }

    private func defaultScriptSources() throws -> [String: String] {
        let scriptsURL = repoRootURL().appendingPathComponent("assets/default-scripts", isDirectory: true)
        let urls = try FileManager.default.contentsOfDirectory(
            at: scriptsURL,
            includingPropertiesForKeys: nil
        )

        var sources: [String: String] = [:]
        for url in urls where url.pathExtension == "emw" {
            sources[url.lastPathComponent] = try String(contentsOf: url, encoding: .utf8)
        }
        return sources
    }
}
