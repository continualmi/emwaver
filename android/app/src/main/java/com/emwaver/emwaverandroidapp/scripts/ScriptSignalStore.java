/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.scripts;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public final class ScriptSignalStore {
    private static final String SIGNALS_DIR = "signals";

    private final File signalsDir;

    public ScriptSignalStore(@NonNull Context context) {
        File appFilesDir = context.getApplicationContext().getFilesDir();
        this.signalsDir = new File(appFilesDir, SIGNALS_DIR);
        // Ensure the directory exists so listing works consistently.
        //noinspection ResultOfMethodCallIgnored
        this.signalsDir.mkdirs();
    }

    public String[] listSignals() {
        File[] files = signalsDir.listFiles();
        if (files == null || files.length == 0) {
            return new String[0];
        }

        List<String> names = new ArrayList<>();
        for (File file : files) {
            if (file == null || !file.isFile()) {
                continue;
            }
            String name = file.getName();
            if (name == null) {
                continue;
            }
            if (name.toLowerCase(Locale.US).endsWith(".raw")) {
                names.add(name);
            }
        }
        Collections.sort(names, String::compareToIgnoreCase);
        return names.toArray(new String[0]);
    }

    public String listSignalsCsv() {
        String[] names = listSignals();
        if (names.length == 0) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < names.length; i += 1) {
            if (i > 0) {
                builder.append('\n');
            }
            builder.append(names[i]);
        }
        return builder.toString();
    }

    @Nullable
    public byte[] readSignal(@Nullable String fileName) {
        String normalized = normalizeSignalName(fileName);
        if (normalized == null) {
            return null;
        }

        File signalFile = new File(signalsDir, normalized);
        if (!signalFile.exists() || !signalFile.isFile()) {
            return null;
        }

        try (FileInputStream fis = new FileInputStream(signalFile);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = fis.read(buffer)) >= 0) {
                if (read > 0) {
                    bos.write(buffer, 0, read);
                }
            }
            return bos.toByteArray();
        } catch (IOException ignored) {
            return null;
        }
    }

    @Nullable
    private String normalizeSignalName(@Nullable String rawName) {
        if (rawName == null) {
            return null;
        }
        String name = rawName.trim();
        if (name.isEmpty()) {
            return null;
        }
        // Prevent path traversal from scripts.
        if (name.contains("/") || name.contains("\\") || name.contains("..")) {
            return null;
        }
        if (!name.toLowerCase(Locale.US).endsWith(".raw")) {
            name = name + ".raw";
        }
        return name;
    }
}
