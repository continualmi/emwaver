package com.emwaver.emwaverandroidapp.github;

public class GitHubUser {
    public final String login;
    public final String name;
    public final String avatarUrl;
    
    public GitHubUser(String login, String name, String avatarUrl) {
        this.login = login;
        this.name = name;
        this.avatarUrl = avatarUrl;
    }
}
