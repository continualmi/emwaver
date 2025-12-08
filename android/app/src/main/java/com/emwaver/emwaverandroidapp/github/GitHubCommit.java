package com.emwaver.emwaverandroidapp.github;

public class GitHubCommit {
    public final String sha;
    public final String date;
    
    public GitHubCommit(String sha, String date) {
        this.sha = sha;
        this.date = date;
    }
}
