package com.emwaver.emwaverandroidapp.github;

public class GitHubFile {
    public final String name;
    public final String type; // "file" or "dir"
    public final String path;
    public final String sha;
    public final String downloadUrl;
    public final long size;
    
    public GitHubFile(String name, String type, String path, String sha, String downloadUrl, long size) {
        this.name = name;
        this.type = type;
        this.path = path;
        this.sha = sha;
        this.downloadUrl = downloadUrl;
        this.size = size;
    }
    
    public boolean isDirectory() {
        return "dir".equals(type);
    }
    
    public boolean isFile() {
        return "file".equals(type);
    }
}
