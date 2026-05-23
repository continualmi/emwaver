/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.List;
import java.util.Map;

/**
 * Tool execution runtime exposed by the host app.
 * <p>
 * Each method returns synchronously for simplicity; the ViewModel calls
 * {@code execute} off the main thread.
 */
public final class AgentToolRuntime {

    public interface ToolProvider {
        /** Return the list of tool definitions (name, description, JSON Schema parameters). */
        @NonNull
        List<AgentToolDefinition> tools();

        /** Return a plain-text context block appended to every user prompt. */
        @NonNull
        String context();

        /** Execute a named tool with the given arguments. */
        @NonNull
        AgentToolResultData execute(@NonNull String name, @NonNull Map<String, AgentToolJSON> arguments);
    }

    @Nullable
    private final ToolProvider provider;

    public AgentToolRuntime(@Nullable ToolProvider provider) {
        this.provider = provider;
    }

    @Nullable
    public List<AgentToolDefinition> tools() {
        return provider != null ? provider.tools() : null;
    }

    @NonNull
    public String context() {
        return provider != null ? provider.context() : "";
    }

    @NonNull
    public AgentToolResultData execute(@NonNull String name, @NonNull Map<String, AgentToolJSON> arguments) {
        if (provider == null) {
            return new AgentToolResultData(null, null, name, arguments, null, false, null,
                    "No tool runtime configured");
        }
        return provider.execute(name, arguments);
    }

    public boolean isAvailable() {
        return provider != null && !provider.tools().isEmpty();
    }
}
