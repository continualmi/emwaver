/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

@testable import EMWaverScriptRuntime
import Foundation
import XCTest

final class ScriptConsoleTests: XCTestCase {
    func testScriptEngineCapturesConsoleOutput() {
        let engine = ScriptEngine()
        var lines: [String] = []
        var errors: [String] = []
        let completed = expectation(description: "script completed")

        engine.setBootstrapSource("")
        engine.consoleHandler = { line in
            lines.append(line)
        }
        engine.setup(
            renderHandler: { _ in },
            errorHandler: { message in
                errors.append(message)
            }
        )

        engine.execute(
            script: """
                console.log("hello", 42);
                console.warn("careful");
                console.error("boom");
                """,
            completion: {
                completed.fulfill()
            }
        )

        wait(for: [completed], timeout: 4)
        XCTAssertTrue(errors.isEmpty, errors.joined(separator: "\n"))
        XCTAssertEqual(lines, [
            "hello 42",
            "[warn] careful",
            "[error] boom",
        ])
    }

    @MainActor
    func testScriptPreviewManagerClearsCapsAndMirrorsErrorsInConsole() async throws {
        let manager = ScriptPreviewManager(bootstrapSource: "")
        let loggingScript = (0..<505)
            .map { "console.log(\"line-\($0)\");" }
            .joined(separator: "\n")

        manager.render(script: loggingScript, name: "Console Cap", moduleSources: [:])
        try await waitUntil(timeoutSeconds: 5) {
            manager.consoleLines.count == 500 && !manager.isRendering
        }

        XCTAssertEqual(manager.consoleLines.count, 500)
        XCTAssertFalse(manager.consoleLines.contains { $0.contains("line-0") })
        XCTAssertTrue(manager.consoleLines.first?.contains("line-5") == true)
        XCTAssertTrue(manager.consoleLines.last?.contains("line-504") == true)

        manager.render(script: "throw new Error(\"kaboom\");", name: "Console Error", moduleSources: [:])
        try await waitUntil(timeoutSeconds: 5) {
            manager.scriptError?.contains("kaboom") == true &&
            manager.consoleLines.contains { $0.contains("[error]") && $0.contains("kaboom") }
        }

        XCTAssertEqual(manager.consoleLines.count, 1)
        XCTAssertTrue(manager.consoleLines[0].contains("[error]"))
        XCTAssertTrue(manager.consoleLines[0].contains("kaboom"))
    }

    @MainActor
    private func waitUntil(timeoutSeconds: TimeInterval, predicate: @escaping () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while !predicate() {
            if Date() > deadline {
                XCTFail("Timed out waiting for predicate")
                return
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }
}
