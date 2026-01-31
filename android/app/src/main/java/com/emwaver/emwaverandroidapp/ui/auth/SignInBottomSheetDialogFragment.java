package com.emwaver.emwaverandroidapp.ui.auth;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.emwaver.emwaverandroidapp.R;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.button.MaterialButton;

public class SignInBottomSheetDialogFragment extends BottomSheetDialogFragment {

    private TextView errorText;
    private TextView notConfiguredText;
    private MaterialButton googleButton;

    private boolean canSignInWithGoogle = false;
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
        googleButton = view.findViewById(R.id.sign_in_google);
        errorText = view.findViewById(R.id.sign_in_error);
        notConfiguredText = view.findViewById(R.id.sign_in_not_configured);

        notNow.setOnClickListener(v -> dismiss());
        googleButton.setOnClickListener(v -> {
            // UI-only stub for now.
            setError("Sign in is not configured in this build");
        });

        applyStateToUi();
    }

    private void applyStateToUi() {
        if (notConfiguredText != null) {
            notConfiguredText.setVisibility(canSignInWithGoogle ? View.GONE : View.VISIBLE);
        }
        if (googleButton != null) {
            googleButton.setEnabled(canSignInWithGoogle);
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
