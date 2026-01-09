/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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
