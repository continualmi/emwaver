package com.emwaver.emwaverandroidapp.wavelets;

import java.util.Collections;
import java.util.Map;

public final class WaveletTree {
    private final WaveletNode root;
    private final Map<String, Object> metadata;

    public WaveletTree(WaveletNode root, Map<String, Object> metadata) {
        this.root = root;
        this.metadata = metadata != null ? Collections.unmodifiableMap(metadata) : Collections.emptyMap();
    }

    public WaveletNode getRoot() {
        return root;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }
}
