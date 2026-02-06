package com.emwaver.emwaverandroidapp.ui.auth;

import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.cloud.CloudAuthManager;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.button.MaterialButton;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;

public class SignInBottomSheetDialogFragment extends BottomSheetDialogFragment {

    public static final String FRAGMENT_RESULT_KEY = "emwaver.sign_in";

    private TextView errorText;
    private TextView notConfiguredText;
    private MaterialButton googleButton;

    private boolean canSignInWithGoogle = false;
    @Nullable private String lastError;

    private GoogleSignInClient googleClient;
    private ActivityResultLauncher<Intent> signInLauncher;

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
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        signInLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (result == null || result.getData() == null) {
                        setError("Sign in cancelled");
                        return;
                    }
                    handleGoogleSignInResult(GoogleSignIn.getSignedInAccountFromIntent(result.getData()));
                }
        );
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        MaterialButton notNow = view.findViewById(R.id.sign_in_not_now);
        googleButton = view.findViewById(R.id.sign_in_google);
        errorText = view.findViewById(R.id.sign_in_error);
        notConfiguredText = view.findViewById(R.id.sign_in_not_configured);

        notNow.setOnClickListener(v -> dismiss());

        CloudAuthManager.getInstance().ensureInitialized(requireContext());

        // Detect whether google-services.json is present (it generates default_web_client_id).
        int webClientIdRes = requireContext().getResources().getIdentifier(
                "default_web_client_id",
                "string",
                requireContext().getPackageName()
        );

        canSignInWithGoogle = webClientIdRes != 0;

        if (canSignInWithGoogle) {
            String webClientId = getString(webClientIdRes);
            GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestEmail()
                    .requestIdToken(webClientId)
                    .build();
            googleClient = GoogleSignIn.getClient(requireContext(), gso);

            googleButton.setOnClickListener(v -> {
                lastError = null;
                applyStateToUi();
                signInLauncher.launch(googleClient.getSignInIntent());
            });
        } else {
            googleButton.setOnClickListener(v -> setError("Google sign-in isn't configured for this build (missing google-services.json)"));
        }

        applyStateToUi();
    }

    private void handleGoogleSignInResult(@NonNull Task<GoogleSignInAccount> task) {
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account == null || account.getIdToken() == null || account.getIdToken().isEmpty()) {
                setError("Google sign-in failed: missing ID token");
                return;
            }

            FirebaseAuth.getInstance()
                    .signInWithCredential(GoogleAuthProvider.getCredential(account.getIdToken(), null))
                    .addOnCompleteListener(t -> {
                        if (!t.isSuccessful()) {
                            String msg = t.getException() != null ? t.getException().getMessage() : "Unknown error";
                            setError("Firebase sign-in failed: " + msg);
                            return;
                        }

                        // Notify listeners (e.g. ScriptsFragment can retry sync).
                        Bundle b = new Bundle();
                        b.putBoolean("success", true);
                        getParentFragmentManager().setFragmentResult(FRAGMENT_RESULT_KEY, b);
                        dismiss();
                    });

        } catch (ApiException e) {
            setError("Google sign-in failed: " + e.getStatusCode());
        }
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
