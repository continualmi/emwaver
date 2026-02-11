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
    public static final String ARG_HANDOFF_CODE = "handoff_code";

    private TextView errorText;
    private TextView notConfiguredText;
    private MaterialButton continueButton;
    private EditText handoffCodeInput;

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
        notConfiguredText = view.findViewById(R.id.sign_in_not_configured);
        handoffCodeInput = view.findViewById(R.id.sign_in_code_input);
        if (handoffCodeInput != null) {
            handoffCodeInput.addTextChangedListener(new TextWatcher() {
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

            String enteredCode = handoffCodeInput != null ? handoffCodeInput.getText().toString().trim() : "";
            if (!enteredCode.isEmpty()) {
                consumeHandoffCode(enteredCode);
                return;
            }

            auth.beginWebSignIn(requireContext());
        });

        String handoffCode = getArguments() != null ? getArguments().getString(ARG_HANDOFF_CODE, "") : "";
        if (handoffCode != null && !handoffCode.trim().isEmpty()) {
            if (handoffCodeInput != null) {
                handoffCodeInput.setText(handoffCode.trim());
            }
            consumeHandoffCode(handoffCode);
        }

        applyStateToUi();
    }

    private void consumeHandoffCode(@NonNull String code) {
        isBusy = true;
        applyStateToUi();

        CloudAuthManager.getInstance().consumeWebHandoffCodeAsync(requireContext(), code, (success, errorMessage) -> {
            isBusy = false;
            if (success) {
                Bundle b = new Bundle();
                b.putBoolean("success", true);
                getParentFragmentManager().setFragmentResult(FRAGMENT_RESULT_KEY, b);
                dismiss();
                return;
            }
            setError(errorMessage != null && !errorMessage.isEmpty() ? errorMessage : "Sign in failed");
        });
    }

    private void applyStateToUi() {
        if (notConfiguredText != null) {
            notConfiguredText.setVisibility(View.VISIBLE);
            notConfiguredText.setText("Sign-in opens the EMWaver website in your browser. Copy the one-time code shown there, then paste it here.");
        }
        if (continueButton != null) {
            continueButton.setEnabled(!isBusy);
            boolean hasCode = handoffCodeInput != null
                    && handoffCodeInput.getText() != null
                    && handoffCodeInput.getText().toString().trim().length() > 0;
            continueButton.setText(isBusy ? "Completing sign in..." : (hasCode ? "Continue with Code" : "Open Browser"));
        }
        if (handoffCodeInput != null) {
            handoffCodeInput.setEnabled(!isBusy);
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
