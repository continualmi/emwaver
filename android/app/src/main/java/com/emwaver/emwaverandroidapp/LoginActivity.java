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
import com.emwaver.emwaverandroidapp.auth.BackendClient;
import com.google.android.material.textfield.TextInputEditText;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.os.Handler;
import android.os.Looper;

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
    private Button loginButton;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        emailInput = findViewById(R.id.input_email);
        passwordInput = findViewById(R.id.input_password);
        errorText = findViewById(R.id.text_error);
        progressBar = findViewById(R.id.progress_login);
        loginButton = findViewById(R.id.button_login);

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
        loginButton.setEnabled(false);

        executor.execute(() -> performLogin(email, password));
    }

    private void performLogin(String email, String password) {
        BackendClient client = BackendClient.getInstance(LoginActivity.this);
        try {
            BackendClient.LoginResult result = client.login(email, password);
            JSONObject user = result.user;
            String userJson = user != null ? user.toString() : null;
            AuthenticationManager.getInstance(LoginActivity.this)
                    .saveSession(result.accessToken, result.refreshToken, userJson);
            mainHandler.post(() -> {
                progressBar.setVisibility(View.GONE);
                loginButton.setEnabled(true);
                navigateToMain();
            });
        } catch (BackendClient.BackendException error) {
            mainHandler.post(() -> {
                progressBar.setVisibility(View.GONE);
                loginButton.setEnabled(true);
                showError(error.getMessage() != null ? error.getMessage() : getString(R.string.login_error_generic));
            });
        }
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

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
