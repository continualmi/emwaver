/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.scripts;

import com.emwaver.emwaverandroidapp.files.UserFileMetadata;

/**
 * Wrapper for UserFileMetadata that tracks whether a script is from assets (hard-coded, read-only)
 * or from custom storage (editable).
 */
public final class ScriptMetadata {
    public enum SourceType {
        ASSET,  // Hard-coded scripts from assets folder, read-only
        CUSTOM  // User's custom scripts from local storage, editable
    }

    private final UserFileMetadata metadata;
    private final SourceType sourceType;

    public ScriptMetadata(UserFileMetadata metadata, SourceType sourceType) {
        this.metadata = metadata;
        this.sourceType = sourceType;
    }

    public UserFileMetadata getMetadata() {
        return metadata;
    }

    public SourceType getSourceType() {
        return sourceType;
    }

    public boolean isAssetScript() {
        return sourceType == SourceType.ASSET;
    }

    public boolean isCustomScript() {
        return sourceType == SourceType.CUSTOM;
    }

    // Convenience methods to delegate to metadata
    public String getId() {
        return metadata != null ? metadata.getId() : null;
    }

    public String getName() {
        return metadata != null ? metadata.getName() : null;
    }

    public String getEtag() {
        return metadata != null ? metadata.getEtag() : null;
    }
}
