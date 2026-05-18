/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import XCTest
@testable import EMWaverScriptRuntime

final class ScriptModuleTranspilerTests: XCTestCase {
    func testNamedImportTranspilesToRequireDestructure() throws {
        let source = #"import { pin, gpio } from "emw-gpio";"#
        let output = try ScriptModuleTranspiler.transpile(source)
        XCTAssertEqual(output, #"const { pin, gpio } = require("emw-gpio");"#)
    }

    func testNamedImportAliasTranspilesToRequireDestructureAlias() throws {
        let source = #"import { render as uiRender } from "emw-ui";"#
        let output = try ScriptModuleTranspiler.transpile(source)
        XCTAssertEqual(output, #"const { render: uiRender } = require("emw-ui");"#)
    }

    func testNamespaceImportTranspilesToRequire() throws {
        let source = #"import * as GPIO from "emw-gpio";"#
        let output = try ScriptModuleTranspiler.transpile(source)
        XCTAssertEqual(output, #"const GPIO = require("emw-gpio");"#)
    }

    func testSideEffectImportTranspilesToRequire() throws {
        let source = #"import "emw-kernel";"#
        let output = try ScriptModuleTranspiler.transpile(source)
        XCTAssertEqual(output, #"require("emw-kernel");"#)
    }
}
