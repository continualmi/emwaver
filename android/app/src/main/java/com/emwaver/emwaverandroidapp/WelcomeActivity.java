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

package com.emwaver.emwaverandroidapp;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;

import androidx.appcompat.app.AppCompatActivity;
import androidx.preference.PreferenceManager;

public class WelcomeActivity extends AppCompatActivity {

    private static final String PREF_HAS_SEEN_WELCOME = "hasSeenWelcome";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Check if user has already seen the welcome screen
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(this);
        boolean hasSeenWelcome = prefs.getBoolean(PREF_HAS_SEEN_WELCOME, false);
        
        if (hasSeenWelcome) {
            // User has seen welcome, continue based on login state
            startNextStep();
            return;
        }
        
        setContentView(R.layout.activity_welcome);
        
        // Initialize views
        Button documentationButton = findViewById(R.id.btn_documentation);
        Button getStartedButton = findViewById(R.id.btn_get_started);
        
        // Set up documentation button
        documentationButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://docs.emwaver.com"));
                startActivity(browserIntent);
            }
        });
        
        // Set up get started button
        getStartedButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                // Mark that user has seen welcome screen
                SharedPreferences.Editor editor = prefs.edit();
                editor.putBoolean(PREF_HAS_SEEN_WELCOME, true);
                editor.apply();

                startNextStep();
            }
        });
    }
    
    private void startNextStep() {
        startMainActivity();
    }

    private void startMainActivity() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
    
    public static boolean shouldShowWelcome(android.content.Context context) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(context);
        return !prefs.getBoolean(PREF_HAS_SEEN_WELCOME, false);
    }
} 
