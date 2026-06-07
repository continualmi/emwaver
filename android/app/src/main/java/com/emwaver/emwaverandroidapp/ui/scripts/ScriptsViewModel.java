/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
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

    public String getLastScriptContent() {
        return lastScriptContent;
    }

    void setLastScriptName(String name) {
        lastScriptName = name;
    }

    public String getLastScriptName() {
        return lastScriptName;
    }

    void setLastScriptId(String id) {
        lastScriptId = id;
    }

    public String getLastScriptId() {
        return lastScriptId;
    }

    void setPreviewActive(boolean active) {
        previewActive = active;
    }

    boolean isPreviewActive() {
        return previewActive;
    }

    void updateStoredSnapshot(@NonNull String id, @NonNull String name, @NonNull String etag, @NonNull String content) {
        ScriptRecord record = getOrCreate(id);
        record.id = id;
        record.name = name;
        record.storedContent = content;
        record.storedEtag = etag;
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
        record.storedContent = content;
        record.storedEtag = etag;
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
    String getStoredContent(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.storedContent : null;
    }

    @Nullable
    String getStoredEtag(@NonNull String id) {
        ScriptRecord record = records.get(id);
        return record != null ? record.storedEtag : null;
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
            String content = record.draftContent != null ? record.draftContent : record.storedContent;
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
            || lowerName.endsWith("_module.emw")
            || lowerName.endsWith(".module.js")
            || lowerName.endsWith("_module.js")) {
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
        String storedContent;
        String storedEtag;
        String draftContent;
        boolean dirty;
    }
}
