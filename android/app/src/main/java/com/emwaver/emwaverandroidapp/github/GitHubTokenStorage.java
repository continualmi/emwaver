package com.emwaver.emwaverandroidapp.github;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;
import androidx.preference.PreferenceManager;

public class GitHubTokenStorage {
    private static final String PREF_GITHUB_TOKEN = "github_access_token";
    private static final String PREF_GITHUB_PAT = "github_pat";
    private static final String PREF_GITHUB_USERNAME = "github_username";
    
    private final SharedPreferences prefs;
    
    public GitHubTokenStorage(Context context) {
        prefs = PreferenceManager.getDefaultSharedPreferences(context);
    }
    
    // OAuth token (public_repo scope)
    public void saveToken(String token) {
        prefs.edit().putString(PREF_GITHUB_TOKEN, token).apply();
    }
    
    public String getToken() {
        return prefs.getString(PREF_GITHUB_TOKEN, null);
    }
    
    // Personal Access Token (PAT) - can have repo scope or specific repo access
    public void savePat(String pat) {
        prefs.edit().putString(PREF_GITHUB_PAT, pat).apply();
    }
    
    public String getPat() {
        return prefs.getString(PREF_GITHUB_PAT, null);
    }
    
    // Get the active token: PAT takes precedence over OAuth token
    public String getActiveToken() {
        String pat = getPat();
        if (!TextUtils.isEmpty(pat)) {
            return pat;
        }
        return getToken();
    }
    
    public void saveUsername(String username) {
        prefs.edit().putString(PREF_GITHUB_USERNAME, username).apply();
    }
    
    public String getUsername() {
        return prefs.getString(PREF_GITHUB_USERNAME, null);
    }
    
    public boolean isAuthenticated() {
        return !TextUtils.isEmpty(getActiveToken());
    }
    
    public boolean hasPat() {
        return !TextUtils.isEmpty(getPat());
    }
    
    public void clearPat() {
        prefs.edit().remove(PREF_GITHUB_PAT).apply();
    }
    
    public void clear() {
        prefs.edit()
            .remove(PREF_GITHUB_TOKEN)
            .remove(PREF_GITHUB_PAT)
            .remove(PREF_GITHUB_USERNAME)
            .apply();
    }
}
