/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.util.Log;

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

    private static final String TAG = "CloudSyncEngine";
    private static final boolean DEBUG_LISTING = true;

    public static final class Summary {
        public int uploaded;
        public int downloaded;
        /** Filenames where cloud is newer than local. */
        public final java.util.List<String> cloudNewerFiles = new java.util.ArrayList<>();
        /** Filenames where local is newer than cloud. */
        public final java.util.List<String> localNewerFiles = new java.util.ArrayList<>();

        public Summary add(Summary other) {
            Summary s = new Summary();
            s.uploaded = this.uploaded + other.uploaded;
            s.downloaded = this.downloaded + other.downloaded;
            s.cloudNewerFiles.addAll(this.cloudNewerFiles);
            s.cloudNewerFiles.addAll(other.cloudNewerFiles);
            s.localNewerFiles.addAll(this.localNewerFiles);
            s.localNewerFiles.addAll(other.localNewerFiles);
            return s;
        }
    }

    public interface Progress {
        void onProgress(int done, int total, String status);
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
            boolean uploadLocalNewer,
            boolean downloadCloudNewer,
            Progress progress
    ) throws IOException {

        if (progress != null) {
            progress.onProgress(0, 0, "Listing cloud…");
        }

        if (DEBUG_LISTING) {
            Log.d(TAG, "syncFolder storageDir=" + storageDir.getAbsolutePath());
            Log.d(TAG, "syncFolder allowedExtensions=" + java.util.Arrays.toString(allowedExtensions));
            Log.d(TAG, "syncFolder uploadLocalNewer=" + uploadLocalNewer);
            Log.d(TAG, "syncFolder downloadCloudNewer=" + downloadCloudNewer);
        }

        List<CloudUserFile> cloudFiles = api.listFiles(baseUrl, accessToken);
        Map<String, CloudUserFile> cloudByName = new HashMap<>();
        for (CloudUserFile f : cloudFiles) {
            cloudByName.put(f.name, f);
        }

        if (DEBUG_LISTING) {
            Log.d(TAG, "cloudFiles count=" + cloudFiles.size());
            for (CloudUserFile f : cloudFiles) {
                if (f == null) continue;
                Log.d(TAG, "cloud: name=" + f.name + " mtimeMs=" + f.mtimeMs + " size=" + f.sizeBytes + " etag=" + f.etag);
            }
        }

        if (!storageDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
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

        if (DEBUG_LISTING) {
            Log.d(TAG, "localFiles matched count=" + localByName.size());
            for (Map.Entry<String, File> e : localByName.entrySet()) {
                File f = e.getValue();
                Log.d(TAG, "local: name=" + e.getKey() + " mtime=" + (f != null ? f.lastModified() : 0) + " size=" + (f != null ? f.length() : 0));
            }
        }

        Set<String> names = new HashSet<>();
        names.addAll(localByName.keySet());
        names.addAll(cloudByName.keySet());

        java.util.List<String> orderedNames = new java.util.ArrayList<>(names);
        java.util.Collections.sort(orderedNames, String::compareToIgnoreCase);

        Summary summary = new Summary();

        int done = 0;
        int total = orderedNames.size();

        for (String name : orderedNames) {
            File local = localByName.get(name);
            CloudUserFile cloud = cloudByName.get(name);

            if (local == null && cloud == null) {
                continue;
            }

            if (local == null) {
                // Cloud-only -> download
                if (DEBUG_LISTING) Log.d(TAG, "decision: download (cloud-only) name=" + name);
                if (progress != null) progress.onProgress(done, total, "Downloading " + name + "…");
                byte[] bytes = api.downloadContentViaBackend(baseUrl, accessToken, cloud.name);
                File dest = new File(storageDir, name);
                writeFile(dest, bytes);
                if (cloud.mtimeMs > 0) {
                    // best-effort
                    boolean lmOk = dest.setLastModified(cloud.mtimeMs);
                    long after = dest.lastModified();
                    if (DEBUG_LISTING) {
                        Log.d(TAG, "setLastModified(" + cloud.mtimeMs + ") ok=" + lmOk + " after=" + after + " name=" + name);
                    }
                }
                summary.downloaded += 1;
                done += 1;
                if (progress != null) progress.onProgress(done, total, "Synced " + name);
                continue;
            }

            if (cloud == null) {
                // Local-only -> upload
                if (DEBUG_LISTING) Log.d(TAG, "decision: upload (local-only) name=" + name);
                if (progress != null) progress.onProgress(done, total, "Uploading " + name + "…");
                byte[] bytes = readFile(local);
                long mtime = local.lastModified();
                String ct = guessContentType(name, contentTypesByExt);
                api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, mtime);
                summary.uploaded += 1;
                done += 1;
                if (progress != null) progress.onProgress(done, total, "Synced " + name);
                continue;
            }

            // Both exist -> compare mtime
            long localMtime = local.lastModified();
            long cloudMtime = cloud.mtimeMs;

            if (localMtime > 0 && cloudMtime > 0) {
                if (localMtime == cloudMtime) {
                    if (DEBUG_LISTING) Log.d(TAG, "decision: skip (mtime equal) name=" + name + " mtime=" + localMtime);
                    done += 1;
                    if (progress != null) progress.onProgress(done, total, "Up to date: " + name);
                    continue;
                }
                if (localMtime > cloudMtime) {
                    if (!uploadLocalNewer) {
                        if (DEBUG_LISTING) Log.d(TAG, "decision: skip (local newer; awaiting confirmation) name=" + name + " localMtime=" + localMtime + " cloudMtime=" + cloudMtime);
                        summary.localNewerFiles.add(name);
                        done += 1;
                        if (progress != null) progress.onProgress(done, total, "Local newer: " + name);
                        continue;
                    }
                    if (DEBUG_LISTING) Log.d(TAG, "decision: upload (local newer) name=" + name + " localMtime=" + localMtime + " cloudMtime=" + cloudMtime);
                    if (progress != null) progress.onProgress(done, total, "Uploading " + name + "…");
                    byte[] bytes = readFile(local);
                    String ct = guessContentType(name, contentTypesByExt);
                    api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, localMtime);
                    summary.uploaded += 1;
                    done += 1;
                    if (progress != null) progress.onProgress(done, total, "Synced " + name);
                    continue;
                }

                // cloud newer
                if (!downloadCloudNewer) {
                    if (DEBUG_LISTING) Log.d(TAG, "decision: skip (cloud newer; awaiting confirmation) name=" + name + " localMtime=" + localMtime + " cloudMtime=" + cloudMtime);
                    summary.cloudNewerFiles.add(name);
                    done += 1;
                    if (progress != null) progress.onProgress(done, total, "Cloud newer: " + name);
                } else {
                    if (DEBUG_LISTING) Log.d(TAG, "decision: download (cloud newer) name=" + name + " localMtime=" + localMtime + " cloudMtime=" + cloudMtime);
                    if (progress != null) progress.onProgress(done, total, "Downloading " + name + "…");
                    byte[] bytes = api.downloadContentViaBackend(baseUrl, accessToken, cloud.name);
                    writeFile(local, bytes);
                    boolean lmOk = local.setLastModified(cloudMtime);
                    long after = local.lastModified();
                    if (DEBUG_LISTING) {
                        Log.d(TAG, "setLastModified(" + cloudMtime + ") ok=" + lmOk + " after=" + after + " name=" + name);
                    }
                    summary.downloaded += 1;
                    done += 1;
                    if (progress != null) progress.onProgress(done, total, "Synced " + name);
                }
                continue;
            }

            // Missing mtime on one side: prefer local to avoid destructive overwrite.
            if (DEBUG_LISTING) Log.d(TAG, "decision: upload (missing mtime on one side) name=" + name + " localMtime=" + localMtime + " cloudMtime=" + cloudMtime);
            if (progress != null) progress.onProgress(done, total, "Uploading " + name + "…");
            byte[] bytes = readFile(local);
            String ct = guessContentType(name, contentTypesByExt);
            api.uploadViaBackend(baseUrl, accessToken, name, ct, bytes, localMtime > 0 ? localMtime : System.currentTimeMillis());
            summary.uploaded += 1;
            done += 1;
            if (progress != null) progress.onProgress(done, total, "Synced " + name);
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
