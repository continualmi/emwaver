package com.emwaver.emwaverandroidapp.github;

public class GitHubRepository {
    public final String name;
    public final String owner;
    public final String fullName;
    public final String description;
    public final String defaultBranch;
    
    public GitHubRepository(String name, String owner, String fullName, String description, String defaultBranch) {
        this.name = name;
        this.owner = owner;
        this.fullName = fullName;
        this.description = description;
        this.defaultBranch = defaultBranch;
    }
}
