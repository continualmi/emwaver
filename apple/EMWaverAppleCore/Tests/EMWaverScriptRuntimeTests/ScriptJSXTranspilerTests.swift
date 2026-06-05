/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import XCTest
@testable import EMWaverScriptRuntime

final class ScriptJSXTranspilerTests: XCTestCase {
    func testTranspilesNestedElementsAndTextChildren() throws {
        let source = """
        render(
          <Column padding={16} spacing={12}>
            <Text font="title2">JSX Hello</Text>
            <Row spacing={12}>
              <Button onTap={increment}>Increment</Button>
              <Button onTap={reset}>Reset</Button>
            </Row>
          </Column>
        );
        """

        let output = try ScriptJSXTranspiler.transpile(source)

        XCTAssertTrue(output.contains(#"JSX.h(Column, { padding: 16, spacing: 12 }"#))
        XCTAssertTrue(output.contains(#"JSX.h(Text, { font: "title2" }, "JSX Hello")"#))
        XCTAssertTrue(output.contains(#"JSX.h(Button, { onTap: increment }, "Increment")"#))
        XCTAssertTrue(output.contains(#"JSX.h(Button, { onTap: reset }, "Reset")"#))
    }

    func testTranspilesExpressionChildren() throws {
        let source = #"<Text>Count: {String(count)}</Text>"#
        let output = try ScriptJSXTranspiler.transpile(source)
        XCTAssertEqual(output, #"JSX.h(Text, null, "Count:", String(count))"#)
    }

    func testTranspilesFunctionComponentRenderShape() throws {
        let source = """
        function App() {
          return <Column><Text>Hello</Text></Column>;
        }
        render(<App />);
        """

        let output = try ScriptJSXTranspiler.transpile(source)

        XCTAssertTrue(output.contains("return JSX.h(Column, null, JSX.h(Text, null, \"Hello\"));"))
        XCTAssertTrue(output.contains("render(JSX.h(App, null));"))
    }

    func testLeavesStringsCommentsAndComparisonsAlone() throws {
        let source = """
        var text = "<Column>";
        // <Column>ignored</Column>
        if (value < Count) { render(); }
        if (value<Count) { render(); }
        """

        let output = try ScriptJSXTranspiler.transpile(source)

        XCTAssertTrue(output.contains(#"var text = "<Column>";"#))
        XCTAssertTrue(output.contains(#"// <Column>ignored</Column>"#))
        XCTAssertTrue(output.contains("if (value < Count) { render(); }"))
        XCTAssertTrue(output.contains("if (value<Count) { render(); }"))
    }

    func testRejectsMismatchedClosingTag() {
        XCTAssertThrowsError(try ScriptJSXTranspiler.transpile(#"<Column><Text>Hello</Column>"#))
    }
}
