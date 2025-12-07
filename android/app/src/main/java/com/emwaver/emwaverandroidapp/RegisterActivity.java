package com.emwaver.emwaverandroidapp;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

public class RegisterActivity extends AppCompatActivity {

    private TextInputEditText emailInput;
    private TextInputEditText usernameInput;
    private TextInputEditText passwordInput;
    private TextInputEditText accessCodeInput;
    private TextInputEditText firstNameInput;
    private TextInputEditText lastNameInput;
    private TextView errorText;
    private ProgressBar progressBar;
    private Button registerButton;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);

        emailInput = findViewById(R.id.input_register_email);
        usernameInput = findViewById(R.id.input_register_username);
        passwordInput = findViewById(R.id.input_register_password);
        accessCodeInput = findViewById(R.id.input_register_access_code);
        firstNameInput = findViewById(R.id.input_register_first_name);
        lastNameInput = findViewById(R.id.input_register_last_name);
        errorText = findViewById(R.id.text_register_error);
        progressBar = findViewById(R.id.progress_register);
        registerButton = findViewById(R.id.button_register);

        registerButton.setOnClickListener(v -> attemptRegister());

        TextView haveAccount = findViewById(R.id.text_have_account);
        haveAccount.setOnClickListener(v -> finish());
    }

    private void attemptRegister() {
        errorText.setVisibility(View.GONE);

        String email = getTrimmedText(emailInput);
        String username = getTrimmedText(usernameInput);
        String password = getTrimmedText(passwordInput);
        String accessCode = getTrimmedText(accessCodeInput);
        String firstName = getTrimmedText(firstNameInput);
        String lastName = getTrimmedText(lastNameInput);

        if (TextUtils.isEmpty(email) || TextUtils.isEmpty(username) || TextUtils.isEmpty(password)) {
            showError(getString(R.string.register_error_missing_fields));
            return;
        }

        progressBar.setVisibility(View.VISIBLE);
        registerButton.setEnabled(false);

        executor.execute(() -> performRegister(email, username, password, firstName, lastName, accessCode));
    }

    private void performRegister(
            String email,
            String username,
            String password,
            String firstName,
            String lastName,
            String accessCode
    ) {
        BackendClient client = BackendClient.getInstance(RegisterActivity.this);
        try {
            BackendClient.LoginResult result = client.register(email, username, password, firstName, lastName, accessCode);
            JSONObject user = result.user;
            String userJson = user != null ? user.toString() : null;
            String entitlementJson = result.entitlement != null ? result.entitlement.toString() : null;
            AuthenticationManager.getInstance(RegisterActivity.this)
                    .saveSession(result.accessToken, result.refreshToken, userJson, entitlementJson);
            mainHandler.post(() -> {
                progressBar.setVisibility(View.GONE);
                registerButton.setEnabled(true);
                navigateToMain();
            });
        } catch (BackendClient.BackendException error) {
            mainHandler.post(() -> {
                progressBar.setVisibility(View.GONE);
                registerButton.setEnabled(true);
                showError(error.getMessage() != null ? error.getMessage() : getString(R.string.register_error_generic));
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

    private String getTrimmedText(TextInputEditText editText) {
        CharSequence text = editText.getText();
        return text != null ? text.toString().trim() : "";
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }
}
