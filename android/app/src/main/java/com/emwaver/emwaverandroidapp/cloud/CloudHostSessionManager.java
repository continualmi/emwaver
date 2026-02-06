/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.cloud;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;

import com.emwaver.emwaverandroidapp.BuildConfig;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;

import org.json.JSONObject;

import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

/**
 * Best-effort host session heartbeat for presence + basic status.
 *
 * Requires Firebase sign-in (Bearer token) unless backend allows anonymous sync.
 */
public final class CloudHostSessionManager {

    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

    private static volatile CloudHostSessionManager instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable tick;

    private CloudHostSessionManager() {}

    public static CloudHostSessionManager getInstance() {
        if (instance == null) {
            synchronized (CloudHostSessionManager.class) {
                if (instance == null) instance = new CloudHostSessionManager();
            }
        }
        return instance;
    }

    private static String getOrCreateHostId(@NonNull Context context) {
        SharedPreferences prefs = context.getSharedPreferences("emwaver", Context.MODE_PRIVATE);
        String key = "emwaver.hostSessionId";
        String v = prefs.getString(key, "");
        if (v != null && !v.trim().isEmpty()) return v.trim();
        String id = UUID.randomUUID().toString();
        prefs.edit().putString(key, id).apply();
        return id;
    }

    public void start(@NonNull Context context, @NonNull DeviceConnectionManager conn) {
        stop();

        Context app = context.getApplicationContext();
        // kick immediately then every 10s
        tick = new Runnable() {
            @Override
            public void run() {
                sendHeartbeat(app, conn);
                handler.postDelayed(this, 10_000);
            }
        };
        handler.post(tick);
    }

    public void stop() {
        if (tick != null) {
            handler.removeCallbacks(tick);
            tick = null;
        }
    }

    private void sendHeartbeat(@NonNull Context context, @NonNull DeviceConnectionManager conn) {
        try {
            CloudAuthManager auth = CloudAuthManager.getInstance();
            auth.ensureInitialized(context);

            String allowAnon = System.getenv("EMWAVER_ALLOW_ANON_SYNC");
            boolean anon = allowAnon != null && allowAnon.trim().equals("1");

            String tok = auth.getIdTokenBlocking();
            if ((tok == null || tok.trim().isEmpty()) && !anon) {
                return;
            }

            String baseUrl = CloudConfig.getBackendBaseUrl(context);
            if (baseUrl == null || baseUrl.trim().isEmpty()) return;

            String hostId = getOrCreateHostId(context);

            boolean usbConnected = conn.isConnected();

            JSONObject payload = new JSONObject();
            payload.put("host_session_id", hostId);
            payload.put("platform", "android");
            payload.put("device_name", Build.MODEL != null ? Build.MODEL : "Android");
            payload.put("app_version", BuildConfig.VERSION_NAME);

            JSONObject caps = new JSONObject();
            caps.put("usb", true);
            caps.put("scripts", true);
            payload.put("capabilities", caps);

            JSONObject status = new JSONObject();
            status.put("usb_connected", usbConnected);
            status.put("connected_port", "");
            status.put("script_running", false);
            status.put("active_script_name", "");
            payload.put("status", status);

            OkHttpClient http = new OkHttpClient.Builder().build();
            RequestBody body = RequestBody.create(payload.toString(), JSON);
            Request.Builder b = new Request.Builder()
                    .url(baseUrl + "/v1/hosts/heartbeat")
                    .post(body)
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json");

            if (tok != null && !tok.trim().isEmpty()) {
                b.header("Authorization", "Bearer " + tok.trim());
            }

            // Fire-and-forget (OkHttp requires execute/enqueue; use enqueue to avoid blocking UI thread).
            http.newCall(b.build()).enqueue(new okhttp3.Callback() {
                @Override public void onFailure(@NonNull okhttp3.Call call, @NonNull java.io.IOException e) {}
                @Override public void onResponse(@NonNull okhttp3.Call call, @NonNull okhttp3.Response response) {
                    response.close();
                }
            });
        } catch (Exception ignored) {
        }
    }
}
