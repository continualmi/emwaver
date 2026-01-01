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

package com.emwaver.emwaverandroidapp.wavelets;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class WaveletNode {
    private final String id;
    private final WaveletNodeType type;
    private final WaveletNodeProps props;
    private final List<WaveletNode> children;

    public WaveletNode(String id, WaveletNodeType type, WaveletNodeProps props, List<WaveletNode> children) {
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

    public WaveletNodeType getType() {
        return type;
    }

    public WaveletNodeProps getProps() {
        return props;
    }

    public List<WaveletNode> getChildren() {
        return children;
    }
}
