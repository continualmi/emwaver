/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp;

import android.os.Bundle;
import android.view.MenuItem;

import androidx.appcompat.app.ActionBar;
import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.Preference;
import androidx.preference.PreferenceFragmentCompat;

public class SettingsActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.settings_activity);
        if (savedInstanceState == null) {
            getSupportFragmentManager()
                    .beginTransaction()
                    .replace(R.id.settings, new SettingsFragment())
                    .commit();
        }
        ActionBar actionBar = getSupportActionBar();
        if (actionBar != null) {
            actionBar.setDisplayHomeAsUpEnabled(true);
        }
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == android.R.id.home) {
            onBackPressed();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    public static class SettingsFragment extends PreferenceFragmentCompat {
        @Override
        public void onCreatePreferences(Bundle savedInstanceState, String rootKey) {
            // Keep settings in the app SharedPreferences file.
            getPreferenceManager().setSharedPreferencesName("emwaver");
            setPreferencesFromResource(R.xml.root_preferences, rootKey);

            Preference appVersionPref = findPreference("app_version");
            if (appVersionPref != null) {
                appVersionPref.setSummary(appVersionSummary());
            }
        }

        private String appVersionSummary() {
            String version = BuildConfig.VERSION_NAME != null && !BuildConfig.VERSION_NAME.trim().isEmpty()
                    ? BuildConfig.VERSION_NAME.trim()
                    : "unknown";
            String commit = BuildConfig.EMWAVER_COMMIT != null ? BuildConfig.EMWAVER_COMMIT.trim() : "";
            if (commit.length() > 7) {
                commit = commit.substring(0, 7);
            }
            return commit.isEmpty() ? version : version + " (" + commit + ")";
        }
    }
} 
