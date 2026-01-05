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
    private static final String KEY_ACCESS_TOKEN = "access_token";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";
    private static final String KEY_USER_JSON = "user_json";
    private static final String KEY_ENTITLEMENT_JSON = "entitlement_json";

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
        return true;
    }

    public void saveSession(String accessToken, String refreshToken, String userJson, String entitlementJson) {
        sharedPreferences.edit()
                .putString(KEY_ACCESS_TOKEN, accessToken)
                .putString(KEY_REFRESH_TOKEN, refreshToken)
                .putString(KEY_USER_JSON, userJson)
                .putString(KEY_ENTITLEMENT_JSON, entitlementJson)
                .apply();
    }

    public void clearSession() {
        sharedPreferences.edit()
                .remove(KEY_ACCESS_TOKEN)
                .remove(KEY_REFRESH_TOKEN)
                .remove(KEY_USER_JSON)
                .remove(KEY_ENTITLEMENT_JSON)
                .apply();
    }

    public String getAccessToken() {
        return "local-only-token";
    }

    public String getRefreshToken() {
        return sharedPreferences.getString(KEY_REFRESH_TOKEN, null);
    }

    public String getUserJson() {
        return sharedPreferences.getString(KEY_USER_JSON, null);
    }

    public String getEntitlementJson() {
        return sharedPreferences.getString(KEY_ENTITLEMENT_JSON, null);
    }
}
