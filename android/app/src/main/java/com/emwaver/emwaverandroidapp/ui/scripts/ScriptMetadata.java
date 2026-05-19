/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
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

    public enum FileKind {
        SCRIPT,
        LIBRARY,
        KERNEL
    }

    private final UserFileMetadata metadata;
    private final SourceType sourceType;
    private final FileKind fileKind;

    public ScriptMetadata(UserFileMetadata metadata, SourceType sourceType) {
        this(metadata, sourceType, FileKind.SCRIPT);
    }

    public ScriptMetadata(UserFileMetadata metadata, SourceType sourceType, FileKind fileKind) {
        this.metadata = metadata;
        this.sourceType = sourceType;
        this.fileKind = fileKind != null ? fileKind : FileKind.SCRIPT;
    }

    public UserFileMetadata getMetadata() {
        return metadata;
    }

    public SourceType getSourceType() {
        return sourceType;
    }

    public FileKind getFileKind() {
        return fileKind;
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
