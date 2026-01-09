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
