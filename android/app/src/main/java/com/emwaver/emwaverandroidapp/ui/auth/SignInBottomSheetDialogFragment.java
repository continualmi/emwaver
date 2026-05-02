package com.emwaver.emwaverandroidapp.ui.auth;

import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.cloud.CloudAuthManager;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.button.MaterialButton;

public class SignInBottomSheetDialogFragment extends BottomSheetDialogFragment {

    public static final String FRAGMENT_RESULT_KEY = "emwaver.sign_in";

    private TextView errorText;
    private TextView helperText;
    private MaterialButton continueButton;
    private EditText apiKeyInput;

    private boolean isBusy = false;
    @Nullable private String lastError;

    public SignInBottomSheetDialogFragment() {
        // Required empty public constructor
    }

    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle savedInstanceState
    ) {
        return inflater.inflate(R.layout.dialog_sign_in, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        MaterialButton notNow = view.findViewById(R.id.sign_in_not_now);
        continueButton = view.findViewById(R.id.sign_in_google);
        errorText = view.findViewById(R.id.sign_in_error);
        helperText = view.findViewById(R.id.sign_in_not_configured);
        apiKeyInput = view.findViewById(R.id.sign_in_code_input);
        if (apiKeyInput != null) {
            apiKeyInput.addTextChangedListener(new TextWatcher() {
                @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
                @Override public void onTextChanged(CharSequence s, int start, int before, int count) { applyStateToUi(); }
                @Override public void afterTextChanged(Editable s) {}
            });
        }

        notNow.setOnClickListener(v -> dismiss());
        CloudAuthManager auth = CloudAuthManager.getInstance();
        auth.ensureInitialized(requireContext());

        continueButton.setOnClickListener(v -> {
            if (isBusy) return;
            lastError = null;
            applyStateToUi();

            String enteredApiKey = apiKeyInput != null ? apiKeyInput.getText().toString().trim() : "";
            if (!enteredApiKey.isEmpty()) {
                saveApiKey(enteredApiKey);
            }
        });

        applyStateToUi();
    }

    private void saveApiKey(@NonNull String apiKey) {
        isBusy = true;
        applyStateToUi();

        CloudAuthManager.getInstance().saveApiKeyAsync(requireContext(), apiKey, (success, errorMessage) -> {
            isBusy = false;
            if (success) {
                Bundle b = new Bundle();
                b.putBoolean("success", true);
                getParentFragmentManager().setFragmentResult(FRAGMENT_RESULT_KEY, b);
                dismiss();
                return;
            }
            setError(errorMessage != null && !errorMessage.isEmpty() ? errorMessage : "Could not save key");
        });
    }

    private void applyStateToUi() {
        if (helperText != null) {
            helperText.setVisibility(View.VISIBLE);
            helperText.setText("Agent replies require an API key. Local scripts and hardware control do not require a key.");
        }
        if (continueButton != null) {
            boolean hasKey = apiKeyInput != null
                    && apiKeyInput.getText() != null
                    && apiKeyInput.getText().toString().trim().length() > 0;
            continueButton.setEnabled(!isBusy && hasKey);
            continueButton.setText(isBusy ? "Saving key..." : "Save key");
        }
        if (apiKeyInput != null) {
            apiKeyInput.setEnabled(!isBusy);
        }
        if (errorText != null) {
            if (lastError != null && !lastError.isEmpty()) {
                errorText.setText(lastError);
                errorText.setVisibility(View.VISIBLE);
            } else {
                errorText.setVisibility(View.GONE);
            }
        }
    }

    private void setError(@NonNull String message) {
        lastError = message;
        applyStateToUi();
    }
}
