package com.emwaver.emwaverandroidapp.github;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;
import androidx.preference.PreferenceManager;

public class GitHubTokenStorage {
    private static final String PREF_GITHUB_TOKEN = "github_access_token";
    private static final String PREF_GITHUB_USERNAME = "github_username";
    
    private final SharedPreferences prefs;
    
    public GitHubTokenStorage(Context context) {
        prefs = PreferenceManager.getDefaultSharedPreferences(context);
    }
    
    public void saveToken(String token) {
        prefs.edit().putString(PREF_GITHUB_TOKEN, token).apply();
    }
    
    public String getToken() {
        return prefs.getString(PREF_GITHUB_TOKEN, null);
    }
    
    public void saveUsername(String username) {
        prefs.edit().putString(PREF_GITHUB_USERNAME, username).apply();
    }
    
    public String getUsername() {
        return prefs.getString(PREF_GITHUB_USERNAME, null);
    }
    
    public boolean isAuthenticated() {
        return !TextUtils.isEmpty(getToken());
    }
    
    public void clear() {
        prefs.edit()
            .remove(PREF_GITHUB_TOKEN)
            .remove(PREF_GITHUB_USERNAME)
            .apply();
    }
}
