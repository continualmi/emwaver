/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

/**
 * Simple auth helper for Android.
 *
 * Source of truth is FirebaseAuth (it persists the signed-in user across app restarts).
 * We fetch fresh Firebase ID tokens for backend calls.
 */
public final class CloudAuthManager {

    private static volatile CloudAuthManager instance;

    private CloudAuthManager() {}

    public static CloudAuthManager getInstance() {
        if (instance == null) {
            synchronized (CloudAuthManager.class) {
                if (instance == null) {
                    instance = new CloudAuthManager();
                }
            }
        }
        return instance;
    }

    /** Ensure Firebase is initialized (safe to call repeatedly). */
    public void ensureInitialized(@NonNull Context context) {
        try {
            FirebaseApp.initializeApp(context.getApplicationContext());
        } catch (Exception ignored) {
            // If google-services.json isn't present, Firebase init may fail.
        }
    }

    public boolean isSignedIn() {
        return FirebaseAuth.getInstance().getCurrentUser() != null;
    }

    @Nullable
    public String getSignedInEmail() {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        return u != null ? u.getEmail() : null;
    }

    @Nullable
    public String getSignedInDisplayName() {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        return u != null ? u.getDisplayName() : null;
    }

    /**
     * Returns a Firebase ID token for backend Authorization: Bearer <token>.
     * Returns "" when not signed in.
     */
    @NonNull
    public String getIdTokenBlocking() {
        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
        if (u == null) {
            return "";
        }
        try {
            return Tasks.await(u.getIdToken(false)).getToken();
        } catch (Exception e) {
            return "";
        }
    }

    public void signOut() {
        FirebaseAuth.getInstance().signOut();
    }
}
