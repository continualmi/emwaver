/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class ScriptNode {
    private final String id;
    private final ScriptNodeType type;
    private final ScriptNodeProps props;
    private final List<ScriptNode> children;

    public ScriptNode(String id, ScriptNodeType type, ScriptNodeProps props, List<ScriptNode> children) {
        this.id = id;
        this.type = type;
        this.props = props;
        if (children == null) {
            this.children = Collections.emptyList();
        } else {
            this.children = Collections.unmodifiableList(new ArrayList<>(children));
        }
    }

    public String getId() {
        return id;
    }

    public ScriptNodeType getType() {
        return type;
    }

    public ScriptNodeProps getProps() {
        return props;
    }

    public List<ScriptNode> getChildren() {
        return children;
    }
}
