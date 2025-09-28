package com.emwaver.emwaverandroidapp;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.google.android.material.textfield.TextInputEditText;

/**
 * Basic login screen placeholder. It currently stores a fake session token locally and
 * routes to {@link MainActivity}. Replace the TODO-marked block once the backend login
 * endpoint is available.
 */
public class LoginActivity extends AppCompatActivity {

    private TextInputEditText emailInput;
    private TextInputEditText passwordInput;
    private TextView errorText;
    private ProgressBar progressBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        emailInput = findViewById(R.id.input_email);
        passwordInput = findViewById(R.id.input_password);
        errorText = findViewById(R.id.text_error);
        progressBar = findViewById(R.id.progress_login);
        Button loginButton = findViewById(R.id.button_login);

        loginButton.setOnClickListener(v -> attemptLogin());
    }

    private void attemptLogin() {
        errorText.setVisibility(View.GONE);

        String email = emailInput.getText().toString().trim();
        String password = passwordInput.getText().toString();

        if (TextUtils.isEmpty(email) || TextUtils.isEmpty(password)) {
            showError(getString(R.string.login_error_missing_fields));
            return;
        }

        progressBar.setVisibility(View.VISIBLE);

        // TODO: Replace with API call to emwaver-backend /auth/login.
        // For now, emulate a successful login by persisting a placeholder session token.
        AuthenticationManager.getInstance(this).saveSession("local-dev-session-token");
        progressBar.setVisibility(View.GONE);
        navigateToMain();
    }

    private void navigateToMain() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    private void showError(String message) {
        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }
}
