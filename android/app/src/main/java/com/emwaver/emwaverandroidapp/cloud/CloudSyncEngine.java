/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class CloudSyncEngine {

    public static final class Summary {
        public int uploaded;
        public int downloaded;
        public int conflicts;

        public Summary add(Summary other) {
            Summary s = new Summary();
            s.uploaded = this.uploaded + other.uploaded;
            s.downloaded = this.downloaded + other.downloaded;
            s.conflicts = this.conflicts + other.conflicts;
            return s;
        }
    }

    public interface Progress {
        void onStatus(String status);
    }

    private final CloudFilesApi api;

    public CloudSyncEngine(CloudFilesApi api) {
        this.api = api;
    }

    public Summary syncFolder(
            String baseUrl,
            String accessToken,
            File storageDir,
            String[] allowedExtensions,
            Map<String, String> contentTypesByExt,
            boolean preferLocal,
            Progress progress
    ) throws IOException {

        if (progress != null) {
            progress.onStatus("Listing cloud…");
        }

        List<CloudUserFile> cloudFiles = api.listFiles(baseUrl, accessToken);
        Map<String, CloudUserFile> cloudByName = new HashMap<>();
        for (CloudUserFile f : cloudFiles) {
            cloudByName.put(f.name, f);
        }

        if (!storageDir.exists()) {
            storageDir.mkdirs();
        }

        File[] localFiles = storageDir.listFiles();
        Map<String, File> localByName = new HashMap<>();
        if (localFiles != null) {
            for (File f : localFiles) {
                if (!f.isFile()) continue;
                String name = f.getName();
                if (!matchesExt(name, allowedExtensions)) continue;
                localByName.put(name, f);
            }
        }

        Set<String> names = new HashSet<>();
        names.addAll(localByName.keySet());
        names.addAll(cloudByName.keySet());

        Summary summary = new Summary();

        for (String name : names) {
            File local = localByName.get(name);
            CloudUserFile cloud = cloudByName.get(name);

            if (local == null && cloud == null) {
                continue;
            }

            if (local == null) {
                // Cloud-only -> download
                if (progress != null) progress.onStatus("Downloading " + name + "…");
                byte[] bytes = api.downloadContentViaBackend(baseUrl, accessToken, cloud.name);
                File dest = new File(storageDir, name);
                writeFile(dest, bytes);
                if (cloud.mtimeMs > 0) {
                    // best-effort
                    dest.setLastModified(cloud.mtimeMs);
                }
                summary.downloaded += 1;
                continue;
            }

            if (cloud == null) {
                // Local-only -> upload
                if (progress != null) progress.onStatus("Uploading " + name + "…");
                byte[] bytes = readFile(local);
                long mtime = local.lastModified();
                String ct = guessContentType(name, contentTypesByExt);
                api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, mtime);
                summary.uploaded += 1;
                continue;
            }

            // Both exist -> compare mtime
            long localMtime = local.lastModified();
            long cloudMtime = cloud.mtimeMs;

            if (localMtime > 0 && cloudMtime > 0) {
                if (localMtime == cloudMtime) {
                    continue;
                }
                if (localMtime > cloudMtime) {
                    if (progress != null) progress.onStatus("Uploading " + name + "…");
                    byte[] bytes = readFile(local);
                    String ct = guessContentType(name, contentTypesByExt);
                    api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, localMtime);
                    summary.uploaded += 1;
                    continue;
                }

                // cloud newer
                if (preferLocal) {
                    // conflict: keep local, save cloud as conflict file
                    if (progress != null) progress.onStatus("Conflict " + name + "…");
                    byte[] cloudBytes = api.downloadContentViaBackend(baseUrl, accessToken, cloud.name);
                    String conflictName = makeCloudConflictName(name, System.currentTimeMillis());
                    File conflictDest = new File(storageDir, conflictName);
                    writeFile(conflictDest, cloudBytes);
                    conflictDest.setLastModified(cloudMtime);
                    summary.conflicts += 1;
                    // and upload local as canonical
                    byte[] localBytes = readFile(local);
                    String ct = guessContentType(name, contentTypesByExt);
                    api.uploadViaBackend(baseUrl, accessToken, name, ct, localBytes, localMtime);
                    summary.uploaded += 1;
                } else {
                    if (progress != null) progress.onStatus("Downloading " + name + "…");
                    byte[] bytes = api.downloadContentViaBackend(baseUrl, accessToken, cloud.name);
                    writeFile(local, bytes);
                    local.setLastModified(cloudMtime);
                    summary.downloaded += 1;
                }
                continue;
            }

            // Missing mtime on one side: prefer local to avoid destructive overwrite.
            if (progress != null) progress.onStatus("Uploading " + name + "…");
            byte[] bytes = readFile(local);
            String ct = guessContentType(name, contentTypesByExt);
            api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, localMtime > 0 ? localMtime : System.currentTimeMillis());
            summary.uploaded += 1;
        }

        return summary;
    }

    private static boolean matchesExt(String name, String[] allowed) {
        if (allowed == null || allowed.length == 0) return true;
        String lower = name.toLowerCase();
        for (String ext : allowed) {
            if (lower.endsWith(ext.toLowerCase())) return true;
        }
        return false;
    }

    private static String guessContentType(String name, Map<String, String> byExt) {
        if (byExt != null) {
            String ext = "";
            int ix = name.lastIndexOf('.');
            if (ix >= 0) ext = name.substring(ix).toLowerCase();
            String v = byExt.get(ext);
            if (v != null && !v.isEmpty()) return v;
        }
        String lower = name.toLowerCase();
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".emw")) return "text/plain";
        if (lower.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static byte[] readFile(File f) throws IOException {
        // java.nio works on API 26+; fallback if needed.
        try {
            return Files.readAllBytes(f.toPath());
        } catch (Throwable t) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            try (java.io.FileInputStream is = new java.io.FileInputStream(f)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            return out.toByteArray();
        }
    }

    private static void writeFile(File f, byte[] bytes) throws IOException {
        try (FileOutputStream os = new FileOutputStream(f, false)) {
            os.write(bytes);
        }
    }

    private static String makeCloudConflictName(String name, long tsMs) {
        int dot = name.lastIndexOf('.');
        if (dot <= 0) {
            return name + ".conflict_cloud_" + tsMs;
        }
        String base = name.substring(0, dot);
        String ext = name.substring(dot);
        return base + ".conflict_cloud_" + tsMs + ext;
    }
}
