/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import JavaScriptCore
@testable import EMWaverScriptRuntime
import XCTest

final class DefaultScriptAssetsTests: XCTestCase {
    func testDefaultScriptsAreEmwScriptsAndTranspile() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let scriptsURL = root.appendingPathComponent("assets/default-scripts", isDirectory: true)
        let urls = try FileManager.default.contentsOfDirectory(
            at: scriptsURL,
            includingPropertiesForKeys: nil
        )

        XCTAssertFalse(urls.contains { $0.pathExtension == "js" })

        let scriptURLs = urls
            .filter { $0.pathExtension == "emw" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertFalse(scriptURLs.isEmpty)

        for url in scriptURLs {
            let source = try String(contentsOf: url, encoding: .utf8)
            let moduleScript = try ScriptModuleTranspiler.transpile(source)
            let executableScript = try ScriptJSXTranspiler.transpile(moduleScript)
            let json = try XCTUnwrap(String(
                data: JSONSerialization.data(withJSONObject: [executableScript], options: []),
                encoding: .utf8
            ))
            let context = try XCTUnwrap(JSContext())
            _ = context.evaluateScript("new Function(\(json.dropFirst().dropLast()))")
            XCTAssertNil(context.exception, url.lastPathComponent)
        }
    }
}
