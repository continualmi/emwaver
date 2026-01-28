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

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModel;

import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class ScriptsViewModel extends ViewModel {
    private String lastScriptContent;
    private String lastScriptName;
    private String lastScriptId;
    private boolean previewActive;

    static final String UNSAVED_KEY = "__unsaved__";

    private final Map<String, ScriptRecord> records = new HashMap<>();

    void setLastScriptContent(String content) {
        lastScriptContent = content;
    }

    String getLastScriptContent() {
        return lastScriptContent;
    }

    void setLastScriptName(String name) {
        lastScriptName = name;
    }

    String getLastScriptName() {
        return lastScriptName;
    }

    void setLastScriptId(String id) {
        lastScriptId = id;
    }

    String getLastScriptId() {
        return lastScriptId;
    }

    void setPreviewActive(boolean active) {
        previewActive = active;
    }

    boolean isPreviewActive() {
        return previewActive;
    }

    void updateRemoteSnapshot(@NonNull String id, @NonNull String name, @NonNull String etag, @NonNull String content) {
        ScriptRecord record = getOrCreate(id);
        record.id = id;
        record.name = name;
        record.remoteContent = content;
        record.remoteEtag = etag;
        if (!record.dirty) {
            record.draftContent = content;
        }
    }

    void updateDraft(@NonNull String id, @Nullable String name, @NonNull String content, boolean dirty) {
        ScriptRecord record = getOrCreate(id);
        record.draftContent = content;
        record.dirty = dirty;
        if (name != null) {
            record.name = name;
        }
    }

    void markClean(@NonNull String id, @NonNull String content, @NonNull String etag) {
        ScriptRecord record = getOrCreate(id);
        record.draftContent = content;
        record.remoteContent = content;
        record.remoteEtag = etag;
        record.dirty = false;
    }

    @Nullable
    String getDraftContent(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.draftContent : null;
    }

    boolean isDirty(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null && record.dirty;
    }

    @Nullable
    String getRemoteContent(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.remoteContent : null;
    }

    @Nullable
    String getRemoteEtag(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.remoteEtag : null;
    }

    @Nullable
    String getName(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.name : null;
    }

    Set<String> getTrackedIds() {
        return Collections.unmodifiableSet(records.keySet());
    }

    Map<String, ScriptRecord> snapshotRecords() {
        return new HashMap<>(records);
    }

    void removeRecord(@NonNull String id) {
        records.remove(id);
    }
    
    void clearAll() {
        records.clear();
        lastScriptContent = null;
        lastScriptName = null;
        lastScriptId = null;
    }

    Map<String, String> getModuleSources() {
        Map<String, String> modules = new HashMap<>();
        for (ScriptRecord record : records.values()) {
            if (record == null) {
                continue;
            }
            String name = record.name != null ? record.name : record.id;
            String content = record.draftContent != null ? record.draftContent : record.remoteContent;
            if (name == null || content == null) {
                continue;
            }
            if (isModuleScript(name, content)) {
                modules.put(name, content);
            }
        }
        return modules;
    }

    private ScriptRecord getOrCreate(@NonNull String id) {
        ScriptRecord record = records.get(id);
        if (record == null) {
            record = new ScriptRecord();
            record.id = id;
            records.put(id, record);
        }
        return record;
    }

    private boolean isModuleScript(@Nullable String name, @Nullable String content) {
        if (content == null) {
            return false;
        }
        String lowerName = name != null ? name.toLowerCase(Locale.US) : "";
        if (lowerName.endsWith(".module.emw")
            || lowerName.endsWith("_module.emw")) {
            return true;
        }
        String normalized = content.trim();
        if (normalized.startsWith("module.exports")) {
            return true;
        }
        if (normalized.contains("module.exports")) {
            return true;
        }
        if (normalized.contains("exports.")) {
            return true;
        }
        return false;
    }

    static final class ScriptRecord {
        String id;
        String name;
        String remoteContent;
        String remoteEtag;
        String draftContent;
        boolean dirty;
    }
}
