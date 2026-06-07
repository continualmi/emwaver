/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.files;

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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class FileRepositoryLocal {

    private static final String TAG = "FileRepositoryLocal";
    private static final String INTERNAL_BOOTSTRAP_NAME = "script_bootstrap.emw";
    private static FileRepositoryLocal instance;

    private static boolean isReservedInternalName(String name) {
        if (name == null) return false;
        return INTERNAL_BOOTSTRAP_NAME.equalsIgnoreCase(name.trim());
    }

    private static boolean matchesExtension(String name, String extension) {
        if (extension == null) {
            return true;
        }
        if (name.endsWith(extension)) {
            return true;
        }
        return ".emw".equalsIgnoreCase(extension) && name.endsWith(".js");
    }

    private final Context appContext;
    private final ExecutorService executor;
    private final Handler mainHandler;
    private final File storageDir;

    private FileRepositoryLocal(Context context) {
        this.appContext = context.getApplicationContext();
        this.executor = Executors.newSingleThreadExecutor();
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.storageDir = new File(appContext.getFilesDir(), "scripts");
        if (!storageDir.exists()) {
            storageDir.mkdirs();
        }
        Log.d(TAG, "Initialized with storage dir: " + storageDir.getAbsolutePath());
    }

    public static synchronized FileRepositoryLocal getInstance(Context context) {
        if (instance == null) {
            instance = new FileRepositoryLocal(context);
        }
        return instance;
    }

    public void listFiles(String extension, RepositoryCallback<List<UserFileMetadata>> callback) {
        executor.execute(() -> {
            try {
                List<UserFileMetadata> result = new ArrayList<>();
                File[] files = storageDir.listFiles();
                if (files != null) {
                    for (File file : files) {
                        if (file.isFile()) {
                            String name = file.getName();
                            if (isReservedInternalName(name)) {
                                continue;
                            }
                            if (matchesExtension(name, extension)) {
                                String id = name;
                                long size = file.length();
                                long lastModified = file.lastModified();
                                String etag = String.valueOf(lastModified);
                                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                                String kind = "file";
                                String contentType = "text/plain";
                                result.add(new UserFileMetadata(id, name, ext, kind, etag, size, contentType));
                            }
                        }
                    }
                }
                Log.d(TAG, "listFiles found " + result.size() + " files");
                mainHandler.post(() -> callback.onSuccess(result));
            } catch (Exception e) {
                Log.e(TAG, "listFiles failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void listFilesWithContent(String extension, RepositoryCallback<List<UserFileData>> callback) {
        executor.execute(() -> {
            try {
                List<UserFileData> result = new ArrayList<>();
                File[] files = storageDir.listFiles();
                if (files != null) {
                    for (File file : files) {
                        if (file.isFile()) {
                            String name = file.getName();
                            if (isReservedInternalName(name)) {
                                continue;
                            }
                            if (matchesExtension(name, extension)) {
                                String id = name;
                                long size = file.length();
                                long lastModified = file.lastModified();
                                String etag = String.valueOf(lastModified);
                                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                                String kind = "file";
                                String contentType = "text/plain";
                                
                                byte[] bytes = readFile(file);
                                String textContent = new String(bytes, StandardCharsets.UTF_8);
                                
                                UserFileMetadata metadata = new UserFileMetadata(id, name, ext, kind, etag, size, contentType);
                                result.add(new UserFileData(metadata, textContent, bytes));
                            }
                        }
                    }
                }
                Log.d(TAG, "listFilesWithContent found " + result.size() + " files");
                mainHandler.post(() -> callback.onSuccess(result));
            } catch (Exception e) {
                Log.e(TAG, "listFilesWithContent failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void getFile(String fileId, RepositoryCallback<UserFileData> callback) {
        executor.execute(() -> {
            try {
                File file = new File(storageDir, fileId);
                if (!file.exists()) {
                    mainHandler.post(() -> callback.onError("File not found"));
                    return;
                }

                byte[] bytes = readFile(file);
                String textContent = new String(bytes, StandardCharsets.UTF_8);
                String name = file.getName();
                long size = file.length();
                long lastModified = file.lastModified();
                String etag = String.valueOf(lastModified);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                String kind = "file";
                String contentType = "text/plain";
                
                UserFileMetadata metadata = new UserFileMetadata(fileId, name, ext, kind, etag, size, contentType);
                UserFileData data = new UserFileData(metadata, textContent, bytes);
                
                Log.d(TAG, "getFile success: " + fileId);
                mainHandler.post(() -> callback.onSuccess(data));
            } catch (Exception e) {
                Log.e(TAG, "getFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void createTextFile(String name, String content, RepositoryCallback<UserFileMetadata> callback) {
        executor.execute(() -> {
            try {
                if (isReservedInternalName(name)) {
                    mainHandler.post(() -> callback.onError("Reserved internal filename"));
                    return;
                }
                File file = new File(storageDir, name);
                writeFile(file, content.getBytes(StandardCharsets.UTF_8));
                
                String id = name;
                long size = file.length();
                long lastModified = file.lastModified();
                String etag = String.valueOf(lastModified);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                String kind = "file";
                String contentType = "text/plain";
                
                UserFileMetadata metadata = new UserFileMetadata(id, name, ext, kind, etag, size, contentType);
                Log.d(TAG, "createTextFile success: " + name);
                mainHandler.post(() -> callback.onSuccess(metadata));
            } catch (Exception e) {
                Log.e(TAG, "createTextFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void createBinaryFile(String name, byte[] data, RepositoryCallback<UserFileMetadata> callback) {
        executor.execute(() -> {
            try {
                if (isReservedInternalName(name)) {
                    mainHandler.post(() -> callback.onError("Reserved internal filename"));
                    return;
                }
                File file = new File(storageDir, name);
                writeFile(file, data);
                
                String id = name;
                long size = file.length();
                long lastModified = file.lastModified();
                String etag = String.valueOf(lastModified);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                String kind = "file";
                String contentType = "application/octet-stream";
                
                UserFileMetadata metadata = new UserFileMetadata(id, name, ext, kind, etag, size, contentType);
                Log.d(TAG, "createBinaryFile success: " + name);
                mainHandler.post(() -> callback.onSuccess(metadata));
            } catch (Exception e) {
                Log.e(TAG, "createBinaryFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void updateTextFile(String fileId, String etag, String content, RepositoryCallback<UserFileMetadata> callback) {
        createTextFile(fileId, content, callback);
    }

    public void updateBinaryFile(String fileId, String etag, byte[] data, RepositoryCallback<UserFileMetadata> callback) {
        createBinaryFile(fileId, data, callback);
    }

    public void renameFile(String fileId, String newName, RepositoryCallback<UserFileMetadata> callback) {
        executor.execute(() -> {
            try {
                if (isReservedInternalName(newName)) {
                    mainHandler.post(() -> callback.onError("Reserved internal filename"));
                    return;
                }
                File oldFile = new File(storageDir, fileId);
                File newFile = new File(storageDir, newName);
                
                if (!oldFile.exists()) {
                    mainHandler.post(() -> callback.onError("File not found"));
                    return;
                }
                
                if (oldFile.renameTo(newFile)) {
                    String id = newName;
                    long size = newFile.length();
                    long lastModified = newFile.lastModified();
                    String etag = String.valueOf(lastModified);
                    String ext = newName.contains(".") ? newName.substring(newName.lastIndexOf(".")) : "";
                    String kind = "file";
                    String contentType = "text/plain";
                    
                    UserFileMetadata metadata = new UserFileMetadata(id, newName, ext, kind, etag, size, contentType);
                    Log.d(TAG, "renameFile success: " + fileId + " -> " + newName);
                    mainHandler.post(() -> callback.onSuccess(metadata));
                } else {
                    mainHandler.post(() -> callback.onError("Failed to rename file"));
                }
            } catch (Exception e) {
                Log.e(TAG, "renameFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void deleteFile(String fileId, String etag, RepositoryCallback<Void> callback) {
        executor.execute(() -> {
            try {
                File file = new File(storageDir, fileId);
                if (file.exists() && file.delete()) {
                    Log.d(TAG, "deleteFile success: " + fileId);
                    mainHandler.post(() -> callback.onSuccess(null));
                } else {
                    mainHandler.post(() -> callback.onError("Failed to delete file"));
                }
            } catch (Exception e) {
                Log.e(TAG, "deleteFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
    }

    public void copyFile(String sourceId, String name, RepositoryCallback<UserFileMetadata> callback) {
        executor.execute(() -> {
            try {
                File sourceFile = new File(storageDir, sourceId);
                File destFile = new File(storageDir, name);
                
                if (!sourceFile.exists()) {
                    mainHandler.post(() -> callback.onError("Source file not found"));
                    return;
                }
                
                byte[] content = readFile(sourceFile);
                writeFile(destFile, content);
                
                String id = name;
                long size = destFile.length();
                long lastModified = destFile.lastModified();
                String etag = String.valueOf(lastModified);
                String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                String kind = "file";
                String contentType = "text/plain";
                
                UserFileMetadata metadata = new UserFileMetadata(id, name, ext, kind, etag, size, contentType);
                Log.d(TAG, "copyFile success: " + sourceId + " -> " + name);
                mainHandler.post(() -> callback.onSuccess(metadata));
            } catch (Exception e) {
                Log.e(TAG, "copyFile failed", e);
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }
        });
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

    // Synchronous helpers used by the app.
    public List<UserFileMetadata> listFiles() {
        List<UserFileMetadata> result = new ArrayList<>();
        File[] files = storageDir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isFile()) {
                    String name = file.getName();
                    String id = name;
                    long size = file.length();
                    long lastModified = file.lastModified();
                    String etag = String.valueOf(lastModified);
                    String ext = name.contains(".") ? name.substring(name.lastIndexOf(".")) : "";
                    String kind = "file";
                    String contentType = "text/plain";
                    result.add(new UserFileMetadata(id, name, ext, kind, etag, size, contentType));
                }
            }
        }
        return result;
    }

    public byte[] readFile(String filename) throws IOException {
        File file = new File(storageDir, filename);
        if (!file.exists()) {
            throw new IOException("File not found: " + filename);
        }
        return readFile(file);
    }

    public void saveFile(String filename, byte[] data) throws IOException {
        File file = new File(storageDir, filename);
        writeFile(file, data);
        Log.d(TAG, "Saved file: " + filename + " (" + data.length + " bytes)");
    }

    public void deleteFile(String filename) throws IOException {
        File file = new File(storageDir, filename);
        if (!file.exists()) {
            throw new IOException("File not found: " + filename);
        }
        if (!file.delete()) {
            throw new IOException("Failed to delete file: " + filename);
        }
        Log.d(TAG, "Deleted file: " + filename);
    }
}
