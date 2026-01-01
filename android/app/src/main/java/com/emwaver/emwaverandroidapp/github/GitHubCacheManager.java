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

package com.emwaver.emwaverandroidapp.github;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class GitHubCacheManager {
    private static final String TAG = "GitHubCacheManager";
    private static GitHubCacheManager instance;
    
    private final Context appContext;
    private final ExecutorService executor;
    private final Handler mainHandler;
    private final File cacheBaseDir;
    
    private GitHubCacheManager(Context context) {
        this.appContext = context.getApplicationContext();
        this.executor = Executors.newSingleThreadExecutor();
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.cacheBaseDir = new File(appContext.getFilesDir(), "github_cache");
        if (!cacheBaseDir.exists()) {
            cacheBaseDir.mkdirs();
        }
        Log.d(TAG, "Initialized with cache dir: " + cacheBaseDir.getAbsolutePath());
    }
    
    public static synchronized GitHubCacheManager getInstance(Context context) {
        if (instance == null) {
            instance = new GitHubCacheManager(context);
        }
        return instance;
    }
    
    public interface CacheCallback<T> {
        void onSuccess(T result);
        void onError(String message);
    }
    
    private File getRepoDir(String owner, String repo) {
        String dirName = owner + "_" + repo;
        return new File(cacheBaseDir, dirName);
    }
    
    private File getFileForPath(String owner, String repo, String path) {
        File repoDir = getRepoDir(owner, repo);
        return new File(repoDir, path);
    }
    
    // Save file content to cache
    public void saveFile(String owner, String repo, String path, String content, CacheCallback<Void> callback) {
        executor.execute(() -> {
            try {
                File targetFile = getFileForPath(owner, repo, path);
                File parentDir = targetFile.getParentFile();
                if (parentDir != null && !parentDir.exists()) {
                    parentDir.mkdirs();
                }
                
                writeFile(targetFile, content.getBytes(StandardCharsets.UTF_8));
                Log.d(TAG, "Saved file to cache: " + path);
                mainHandler.post(() -> callback.onSuccess(null));
            } catch (Exception e) {
                Log.e(TAG, "Failed to save file to cache: " + path, e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    // Save binary file to cache
    public void saveBinaryFile(String owner, String repo, String path, byte[] content, CacheCallback<Void> callback) {
        executor.execute(() -> {
            try {
                File targetFile = getFileForPath(owner, repo, path);
                File parentDir = targetFile.getParentFile();
                if (parentDir != null && !parentDir.exists()) {
                    parentDir.mkdirs();
                }
                
                writeFile(targetFile, content);
                Log.d(TAG, "Saved binary file to cache: " + path);
                mainHandler.post(() -> callback.onSuccess(null));
            } catch (Exception e) {
                Log.e(TAG, "Failed to save binary file to cache: " + path, e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    // Read file content from cache
    public void getFile(String owner, String repo, String path, CacheCallback<String> callback) {
        executor.execute(() -> {
            try {
                File file = getFileForPath(owner, repo, path);
                if (!file.exists()) {
                    mainHandler.post(() -> callback.onError("File not found in cache"));
                    return;
                }
                
                byte[] content = readFile(file);
                String contentStr = new String(content, StandardCharsets.UTF_8);
                Log.d(TAG, "Read file from cache: " + path);
                mainHandler.post(() -> callback.onSuccess(contentStr));
            } catch (Exception e) {
                Log.e(TAG, "Failed to read file from cache: " + path, e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    // Read binary file from cache
    public void getBinaryFile(String owner, String repo, String path, CacheCallback<byte[]> callback) {
        executor.execute(() -> {
            try {
                File file = getFileForPath(owner, repo, path);
                if (!file.exists()) {
                    mainHandler.post(() -> callback.onError("File not found in cache"));
                    return;
                }
                
                byte[] content = readFile(file);
                Log.d(TAG, "Read binary file from cache: " + path);
                mainHandler.post(() -> callback.onSuccess(content));
            } catch (Exception e) {
                Log.e(TAG, "Failed to read binary file from cache: " + path, e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    // Check if file exists in cache
    public boolean fileExists(String owner, String repo, String path) {
        File file = getFileForPath(owner, repo, path);
        return file.exists();
    }
    
    // List all files in cache (recursive)
    public void listFiles(String owner, String repo, CacheCallback<List<String>> callback) {
        executor.execute(() -> {
            try {
                File repoDir = getRepoDir(owner, repo);
                List<String> files = new ArrayList<>();
                listFilesRecursive(repoDir, repoDir, files);
                Log.d(TAG, "Listed " + files.size() + " files from cache");
                mainHandler.post(() -> callback.onSuccess(files));
            } catch (Exception e) {
                Log.e(TAG, "Failed to list files from cache", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    private void listFilesRecursive(File baseDir, File currentDir, List<String> files) {
        File[] children = currentDir.listFiles();
        if (children == null) return;
        
        for (File child : children) {
            if (child.isFile()) {
                String relativePath = baseDir.toPath().relativize(child.toPath()).toString();
                files.add(relativePath);
            } else if (child.isDirectory()) {
                listFilesRecursive(baseDir, child, files);
            }
        }
    }
    
    // Clear cache for a repository
    public void clearCache(String owner, String repo, CacheCallback<Void> callback) {
        executor.execute(() -> {
            try {
                File repoDir = getRepoDir(owner, repo);
                if (repoDir.exists()) {
                    deleteRecursive(repoDir);
                    Log.d(TAG, "Cleared cache for " + owner + "/" + repo);
                }
                mainHandler.post(() -> callback.onSuccess(null));
            } catch (Exception e) {
                Log.e(TAG, "Failed to clear cache", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }
    
    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }
    
    private byte[] readFile(File file) throws IOException {
        FileInputStream fis = new FileInputStream(file);
        byte[] buffer = new byte[(int) file.length()];
        fis.read(buffer);
        fis.close();
        return buffer;
    }
    
    private void writeFile(File file, byte[] data) throws IOException {
        FileOutputStream fos = new FileOutputStream(file);
        fos.write(data);
        fos.close();
    }
}
