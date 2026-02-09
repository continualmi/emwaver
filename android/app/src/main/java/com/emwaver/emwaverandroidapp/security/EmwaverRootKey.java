/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.security;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;

import com.emwaver.emwaverandroidapp.BuildConfig;

import android.util.Base64;

/**
 * Root public key used to verify per-device identity proofs.
 *
 * Equivalent to macOS EmwaverRootKey.swift:
 * - preferred source: BuildConfig.EMWAVER_ROOT_PUBLIC_KEY_B64 (Gradle buildConfigField)
 * - fallback: AndroidManifest application meta-data key EMWAVER_ROOT_PUBLIC_KEY_B64
 */
public final class EmwaverRootKey {
    private EmwaverRootKey() {}

    public static byte[] getPublicKeyRaw(Context context) {
        String b64 = null;
        try {
            if (BuildConfig.EMWAVER_ROOT_PUBLIC_KEY_B64 != null && !BuildConfig.EMWAVER_ROOT_PUBLIC_KEY_B64.trim().isEmpty()) {
                b64 = BuildConfig.EMWAVER_ROOT_PUBLIC_KEY_B64.trim();
            }
        } catch (Throwable ignored) {
        }

        if (b64 == null || b64.trim().isEmpty()) {
            b64 = getManifestMetaData(context, "EMWAVER_ROOT_PUBLIC_KEY_B64");
        }

        if (b64 == null) {
            return null;
        }
        b64 = b64.trim();
        if (b64.isEmpty()) {
            return null;
        }

        try {
            byte[] raw = Base64.decode(b64, Base64.DEFAULT);
            if (raw.length != 32) {
                return null;
            }
            return raw;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String getManifestMetaData(Context context, String key) {
        if (context == null) return null;
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(context.getPackageName(), PackageManager.GET_META_DATA);
            Bundle md = ai != null ? ai.metaData : null;
            if (md == null) return null;
            Object v = md.get(key);
            return v != null ? String.valueOf(v) : null;
        } catch (Exception e) {
            return null;
        }
    }
}
