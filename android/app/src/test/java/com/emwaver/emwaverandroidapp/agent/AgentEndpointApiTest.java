/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AgentEndpointApiTest {
    @Test
    public void userInputIncludesCurrentScriptContext() {
        String output = AgentEndpointApi.buildUserInput(
                "Help fix this",
                new AgentEndpointApi.ScriptContext("blink.js", "UI.render(<Text>Hello</Text>);"));

        assertEquals(
                "Help fix this\n\nScript `blink.js`:\n```emw\nUI.render(<Text>Hello</Text>);\n```",
                output);
    }

    @Test
    public void userInputOmitsEmptyScriptContext() {
        String output = AgentEndpointApi.buildUserInput(
                "Help fix this",
                new AgentEndpointApi.ScriptContext("blink.js", "  "));

        assertEquals("Help fix this", output);
    }
}
