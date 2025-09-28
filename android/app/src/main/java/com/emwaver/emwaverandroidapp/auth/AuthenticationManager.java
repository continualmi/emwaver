package com.emwaver.emwaverandroidapp.auth;

import android.content.Context;
import android.content.SharedPreferences;
import android.text.TextUtils;

/**
 * Lightweight session storage for login state. When backend integration is ready,
 * replace the placeholder token handling with the actual access/refresh tokens
 * returned by emwaver-backend.
 */
public class AuthenticationManager {

    private static final String PREF_NAME = "auth_prefs";
    private static final String KEY_SESSION_TOKEN = "session_token";

    private static AuthenticationManager instance;

    private final SharedPreferences sharedPreferences;

    private AuthenticationManager(Context context) {
        sharedPreferences = context.getApplicationContext()
                .getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public static synchronized AuthenticationManager getInstance(Context context) {
        if (instance == null) {
            instance = new AuthenticationManager(context);
        }
        return instance;
    }

    public boolean isLoggedIn() {
        return !TextUtils.isEmpty(sharedPreferences.getString(KEY_SESSION_TOKEN, ""));
    }

    public void saveSession(String token) {
        sharedPreferences.edit().putString(KEY_SESSION_TOKEN, token).apply();
    }

    public void clearSession() {
        sharedPreferences.edit().remove(KEY_SESSION_TOKEN).apply();
    }

    public String getSessionToken() {
        return sharedPreferences.getString(KEY_SESSION_TOKEN, null);
    }
}
