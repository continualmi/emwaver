/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ScriptSourceTranspilerTest {
    @Test
    public void transpilesNamedImportsAndAliases() {
        String source = "import { JSX, render as renderTree } from \"emw-jsx\";\nrenderTree(JSX.h(App, null));";

        String out = ScriptSourceTranspiler.transpile(source);

        assertTrue(out.contains("var __emw_mod_0 = require(\"emw-jsx\");"));
        assertTrue(out.contains("var JSX = __emw_mod_0.JSX;"));
        assertTrue(out.contains("var renderTree = __emw_mod_0.render;"));
        assertFalse(out.contains("import "));
    }

    @Test
    public void transpilesNestedJsxElementsAndText() {
        String source = "render(<Column padding={16}><Text>Hello</Text><Button onTap={increment}>Increment</Button></Column>);";

        String out = ScriptSourceTranspiler.transpile(source);

        assertTrue(out.contains("JSX.h(Column, { padding: 16 }"));
        assertTrue(out.contains("JSX.h(Text, null, \"Hello\")"));
        assertTrue(out.contains("JSX.h(Button, { onTap: increment }, \"Increment\")"));
        assertFalse(out.contains("<Column"));
    }

    @Test
    public void leavesStringsAndComparisonsAlone() {
        String source = "var text = \"<Column>\";\nif (count < 3) { render(<Text>{text}</Text>); }";

        String out = ScriptSourceTranspiler.transpile(source);

        assertTrue(out.contains("var text = \"<Column>\";"));
        assertTrue(out.contains("count < 3"));
        assertTrue(out.contains("JSX.h(Text, null, text)"));
    }
}
