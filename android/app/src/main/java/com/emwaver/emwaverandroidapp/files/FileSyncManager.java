package com.emwaver.emwaverandroidapp.files;

import android.content.Context;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;

public class FileSyncManager {
    private static final String TAG = "FileSyncManager";
    private static FileSyncManager instance;
    
    private final Context context;
    private final FileRepositoryLocal fileRepo;
    private BleResponseCallback bleCallback;
    
    // Active transfer state
    private static class TransferState {
        String filename;
        long totalSize;
        long bytesReceived;
        int expectedSeq;
        File tempFile;
        FileOutputStream tempStream;
        MessageDigest digest;
        
        TransferState() {
            try {
                digest = MessageDigest.getInstance("SHA-256");
            } catch (NoSuchAlgorithmException e) {
                Log.e(TAG, "SHA-256 not available", e);
            }
        }
        
        void reset() {
            filename = null;
            totalSize = 0;
            bytesReceived = 0;
            expectedSeq = 0;
            if (tempStream != null) {
                try {
                    tempStream.close();
                } catch (IOException e) {
                    Log.e(TAG, "Error closing temp stream", e);
                }
                tempStream = null;
            }
            if (tempFile != null && tempFile.exists()) {
                tempFile.delete();
                tempFile = null;
            }
            if (digest != null) {
                digest.reset();
            }
        }
    }
    
    private TransferState activeTransfer;
    
    private FileSyncManager(Context context) {
        this.context = context.getApplicationContext();
        this.fileRepo = FileRepositoryLocal.getInstance(context);
        this.activeTransfer = new TransferState();
    }
    
    public static synchronized FileSyncManager getInstance(Context context) {
        if (instance == null) {
            instance = new FileSyncManager(context);
        }
        return instance;
    }
    
    public interface BleResponseCallback {
        void sendFileResponse(String json);
    }
    
    public void setBleCallback(BleResponseCallback callback) {
        this.bleCallback = callback;
    }
    
    /**
     * Handle incoming file transfer packet from BLE
     */
    public void handleFilePacket(byte[] data) {
        if (data == null || data.length == 0) {
            Log.w(TAG, "Empty file packet received");
            return;
        }
        
        try {
            String json = new String(data, "UTF-8");
            JSONObject packet = new JSONObject(json);
            String op = packet.getString("op");
            
            Log.d(TAG, "Received file packet: " + op);
            
            switch (op) {
                case "start":
                    handleStartPacket(packet);
                    break;
                case "chunk":
                    handleChunkPacket(packet);
                    break;
                case "commit":
                    handleCommitPacket(packet);
                    break;
                case "list":
                    handleListRequest();
                    break;
                case "get":
                    handleGetRequest(packet);
                    break;
                default:
                    Log.w(TAG, "Unknown file operation: " + op);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling file packet", e);
            sendErrorResponse("Invalid packet format");
        }
    }
    
    private void handleStartPacket(JSONObject packet) throws JSONException {
        String name = packet.getString("name");
        long size = packet.getLong("size");
        String type = packet.optString("type", "unknown");
        
        Log.i(TAG, String.format("Starting transfer: %s (%d bytes, type: %s)", 
                                 name, size, type));
        
        // Reset any previous transfer
        activeTransfer.reset();
        
        // Create temp file
        File tempDir = new File(context.getCacheDir(), "sync_temp");
        if (!tempDir.exists()) {
            tempDir.mkdirs();
        }
        
        activeTransfer.filename = name;
        activeTransfer.totalSize = size;
        activeTransfer.bytesReceived = 0;
        activeTransfer.expectedSeq = 0;
        activeTransfer.tempFile = new File(tempDir, name + ".tmp");
        
        try {
            activeTransfer.tempStream = new FileOutputStream(activeTransfer.tempFile);
            Log.d(TAG, "Temp file created: " + activeTransfer.tempFile.getAbsolutePath());
        } catch (IOException e) {
            Log.e(TAG, "Failed to create temp file", e);
            sendErrorResponse("Failed to create temp file");
            activeTransfer.reset();
        }
    }
    
    private void handleChunkPacket(JSONObject packet) throws JSONException {
        if (activeTransfer.tempStream == null) {
            Log.e(TAG, "Received chunk without active transfer");
            sendErrorResponse("No active transfer");
            return;
        }
        
        int seq = packet.getInt("seq");
        String hexData = packet.getString("data");
        
        if (seq != activeTransfer.expectedSeq) {
            Log.e(TAG, String.format("Sequence mismatch: expected %d, got %d",
                                     activeTransfer.expectedSeq, seq));
            sendErrorResponse("Sequence error");
            return;
        }
        
        // Decode hex data
        byte[] data = hexStringToBytes(hexData);
        
        try {
            // Write to temp file
            activeTransfer.tempStream.write(data);
            activeTransfer.bytesReceived += data.length;
            activeTransfer.expectedSeq++;
            
            // Update hash
            if (activeTransfer.digest != null) {
                activeTransfer.digest.update(data);
            }
            
            Log.d(TAG, String.format("Chunk %d received (%d bytes, %d/%d total)",
                                     seq, data.length, 
                                     activeTransfer.bytesReceived, 
                                     activeTransfer.totalSize));
        } catch (IOException e) {
            Log.e(TAG, "Error writing chunk", e);
            sendErrorResponse("Write error");
            activeTransfer.reset();
        }
    }
    
    private void handleCommitPacket(JSONObject packet) throws JSONException {
        if (activeTransfer.tempStream == null) {
            Log.e(TAG, "Received commit without active transfer");
            sendErrorResponse("No active transfer");
            return;
        }
        
        String expectedHash = packet.getString("hash");
        
        try {
            // Close temp file
            activeTransfer.tempStream.close();
            activeTransfer.tempStream = null;
            
            // Verify hash
            if (activeTransfer.digest != null) {
                byte[] hashBytes = activeTransfer.digest.digest();
                String actualHash = bytesToHex(hashBytes);
                
                if (!actualHash.equalsIgnoreCase(expectedHash)) {
                    Log.e(TAG, String.format("Hash mismatch: expected %s, got %s",
                                             expectedHash, actualHash));
                    sendErrorResponse("Hash verification failed");
                    activeTransfer.reset();
                    return;
                }
            }
            
            // Move to final location
            File storageDir = new File(context.getFilesDir(), "wavelets");
            if (!storageDir.exists()) {
                storageDir.mkdirs();
            }
            
            File finalFile = new File(storageDir, activeTransfer.filename);
            if (activeTransfer.tempFile.renameTo(finalFile)) {
                Log.i(TAG, String.format("Transfer complete: %s (%d bytes)",
                                         activeTransfer.filename,
                                         activeTransfer.bytesReceived));
                sendSuccessResponse();
            } else {
                Log.e(TAG, "Failed to move temp file to final location");
                sendErrorResponse("Failed to finalize file");
            }
            
            activeTransfer.reset();
            
        } catch (IOException e) {
            Log.e(TAG, "Error finalizing transfer", e);
            sendErrorResponse("Finalization error");
            activeTransfer.reset();
        }
    }
    
    private void handleListRequest() {
        fileRepo.listFiles(".js", new RepositoryCallback<List<UserFileMetadata>>() {
            @Override
            public void onSuccess(List<UserFileMetadata> files) {
                Log.d(TAG, "File list requested: " + files.size() + " files");
                
                // Build JSON array of files
                try {
                    org.json.JSONArray filesArray = new org.json.JSONArray();
                    for (UserFileMetadata file : files) {
                        org.json.JSONObject fileObj = new org.json.JSONObject();
                        fileObj.put("name", file.getName());
                        fileObj.put("size", file.getSizeBytes());
                        fileObj.put("etag", file.getEtag());
                        filesArray.put(fileObj);
                    }
                    
                    org.json.JSONObject response = new org.json.JSONObject();
                    response.put("op", "list-response");
                    response.put("files", filesArray);
                    response.put("count", files.size());
                    
                    // TODO: Send via BLE back to firmware
                    String responseJson = response.toString();
                    Log.d(TAG, "List response: " + responseJson);
                    
                    // We need BLEService to send this back
                    sendListResponse(responseJson);
                    
                } catch (org.json.JSONException e) {
                    Log.e(TAG, "Error building file list JSON", e);
                    sendErrorResponse("JSON error");
                }
            }
            
            @Override
            public void onError(String error) {
                Log.e(TAG, "Failed to list files: " + error);
                sendErrorResponse("Failed to list files");
            }
        });
    }
    
    private void sendListResponse(String json) {
        if (bleCallback != null) {
            bleCallback.sendFileResponse(json);
        } else {
            Log.w(TAG, "No BLE callback set, cannot send list response");
        }
    }
    
    private void handleGetRequest(JSONObject packet) throws JSONException {
        String name = packet.getString("name");
        // TODO: Implement file read and send back to CLI
        Log.d(TAG, "File requested: " + name);
    }
    
    private void sendSuccessResponse() {
        // TODO: Send success packet back via BLE
        Log.d(TAG, "Transfer successful");
    }
    
    private void sendErrorResponse(String message) {
        // TODO: Send error packet back via BLE
        Log.e(TAG, "Transfer error: " + message);
    }
    
    // Utility methods
    private static byte[] hexStringToBytes(String hex) {
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                                + Character.digit(hex.charAt(i+1), 16));
        }
        return data;
    }
    
    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
    
    public String getSyncStatus() {
        if (activeTransfer.tempStream != null) {
            return String.format("Receiving %s: %d/%d bytes (%.1f%%)",
                                activeTransfer.filename,
                                activeTransfer.bytesReceived,
                                activeTransfer.totalSize,
                                (activeTransfer.bytesReceived * 100.0 / activeTransfer.totalSize));
        }
        return "Idle";
    }
}
