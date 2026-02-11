/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Simple auth helper for Android.
 *
 * Source of truth is FirebaseAuth (it persists the signed-in user across app restarts).
 * We fetch fresh Firebase ID tokens for backend calls.
 */
public final class CloudAuthManager {

    public interface SignInCallback {
        void onResult(boolean success, @Nullable String errorMessage);
    }

    private static volatile CloudAuthManager instance;

    private final OkHttpClient http = new OkHttpClient.Builder().build();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

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

    public void beginWebSignIn(@NonNull Context context) {
        String base = CloudConfig.getFrontendBaseUrl(context).trim();
        // Android uses the same handoff UX as desktop: sign in on web, copy one-time code,
        // then paste it back in-app. Keep deep-link callback support as optional fallback.
        String redirect = Uri.encode("/auth/handoff");
        String url = base + "/signin?redirect=" + redirect;
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(browser);
    }

    public void consumeWebHandoffCodeAsync(
            @NonNull Context context,
            @Nullable String code,
            @NonNull SignInCallback callback
    ) {
        ensureInitialized(context);

        final String trimmed = code == null ? "" : code.trim().toUpperCase();
        if (trimmed.isEmpty()) {
            callback.onResult(false, "Missing handoff code");
            return;
        }

        new Thread(() -> {
            try {
                String customToken = fetchCustomToken(context, trimmed);
                mainHandler.post(() -> FirebaseAuth.getInstance()
                        .signInWithCustomToken(customToken)
                        .addOnCompleteListener(task -> {
                            if (task.isSuccessful()) {
                                callback.onResult(true, null);
                            } else {
                                String msg = task.getException() != null
                                        ? task.getException().getMessage()
                                        : "Firebase sign-in failed";
                                callback.onResult(false, msg);
                            }
                        }));
            } catch (Exception e) {
                String msg = e.getMessage() != null ? e.getMessage() : "Sign in failed";
                mainHandler.post(() -> callback.onResult(false, msg));
            }
        }).start();
    }

    @NonNull
    private String fetchCustomToken(@NonNull Context context, @NonNull String code) throws Exception {
        String url = CloudConfig.getBackendBaseUrl(context).trim() + "/v1/auth/handoff/consume";
        JSONObject payload = new JSONObject();
        payload.put("code", code);

        RequestBody body = RequestBody.create(
                payload.toString(),
                MediaType.parse("application/json")
        );

        Request req = new Request.Builder()
                .url(url)
                .post(body)
                .build();

        try (Response res = http.newCall(req).execute()) {
            String json = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) {
                throw new IOException(json.isEmpty()
                        ? ("Handoff consume failed: HTTP " + res.code())
                        : json);
            }

            JSONObject root = new JSONObject(json);
            String customToken = root.optString("firebase_custom_token", "");
            if (customToken.isEmpty()) {
                throw new IOException("Missing firebase_custom_token");
            }
            return customToken;
        }
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
            // Force refresh to avoid returning an empty/expired token when user is signed in.
            return Tasks.await(u.getIdToken(true)).getToken();
        } catch (Exception e) {
            return "";
        }
    }

    public void signOut() {
        FirebaseAuth.getInstance().signOut();
    }
}
