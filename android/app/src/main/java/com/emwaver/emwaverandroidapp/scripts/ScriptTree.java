/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.scripts;

import java.util.Collections;
import java.util.Map;

public final class ScriptTree {
    private final ScriptNode root;
    private final Map<String, Object> metadata;

    public ScriptTree(ScriptNode root, Map<String, Object> metadata) {
        this.root = root;
        this.metadata = metadata != null ? Collections.unmodifiableMap(metadata) : Collections.emptyMap();
    }

    public ScriptNode getRoot() {
        return root;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }
}
