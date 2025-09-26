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
