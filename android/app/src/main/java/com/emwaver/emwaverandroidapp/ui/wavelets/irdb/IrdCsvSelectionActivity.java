package com.emwaver.emwaverandroidapp.ui.wavelets.irdb;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.emwaver.emwaverandroidapp.wavelets.IrdBackendClient;
import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class IrdCsvSelectionActivity extends AppCompatActivity {

    public static final String EXTRA_SCRIPT_NAME = "extra_script_name";
    public static final String EXTRA_SCRIPT_CONTENT = "extra_script_content";
    public static final String EXTRA_SCRIPT_METADATA = "extra_script_metadata";

    private static final String EXTRA_BRAND = "extra_brand";
    private static final String EXTRA_REMOTE = "extra_remote";

    public static Intent createIntent(Context context, String brand, String remote) {
        Intent intent = new Intent(context, IrdCsvSelectionActivity.class);
        intent.putExtra(EXTRA_BRAND, brand);
        intent.putExtra(EXTRA_REMOTE, remote);
        return intent;
    }

    private String brand;
    private String remote;
    private ProgressBar progressBar;
    private TextView emptyState;
    private ListView listView;
    private TextInputEditText searchInput;
    private ArrayAdapter<String> adapter;
    private final List<String> variants = new ArrayList<>();
    private IrdBackendClient backendClient;
    private AuthenticationManager authenticationManager;
    private AlertDialog importProgressDialog;
    private ProgressBar importProgressBar;
    private TextView importProgressText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_irdb_list);

        brand = getIntent().getStringExtra(EXTRA_BRAND);
        remote = getIntent().getStringExtra(EXTRA_REMOTE);
        if (TextUtils.isEmpty(brand) || TextUtils.isEmpty(remote)) {
            Toast.makeText(this, "Missing remote details", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        backendClient = new IrdBackendClient();
        authenticationManager = AuthenticationManager.getInstance(this);

        setupToolbar();
        initViews();
        setupList();
        loadVariants();
    }

    private void setupToolbar() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setTitle("Select Variant");
        setSupportActionBar(toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
            getSupportActionBar().setDisplayShowHomeEnabled(true);
            getSupportActionBar().setSubtitle(brand + " · " + remote);
        }
        toolbar.setNavigationOnClickListener(v -> finish());
    }

    private void initViews() {
        progressBar = findViewById(R.id.progress);
        emptyState = findViewById(R.id.empty_state);
        listView = findViewById(R.id.list_view);
        searchInput = findViewById(R.id.search_input);
        TextInputLayout layout = findViewById(R.id.search_input_layout);
        if (layout != null) {
            layout.setHint("Search variants");
        }
        listView.setEmptyView(emptyState);
    }

    private void setupList() {
        adapter = new ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, android.R.id.text1, new ArrayList<>()) {
            @NonNull
            @Override
            public View getView(int position, View convertView, @NonNull android.view.ViewGroup parent) {
                View view = super.getView(position, convertView, parent);
                TextView text = view.findViewById(android.R.id.text1);
                String item = getItem(position);
                if (item != null) {
                    text.setText(item);
                }
                return view;
            }
        };
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            String fileName = adapter.getItem(position);
            if (fileName != null) {
                importWavelet(fileName);
            }
        });

        searchInput.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                adapter.getFilter().filter(s);
            }

            @Override
            public void afterTextChanged(Editable s) {
            }
        });
    }

    private void loadVariants() {
        showProgress(true);
        String accessToken = authenticationManager.getAccessToken();
        backendClient.fetchVariants(accessToken, brand, remote, new IrdBackendClient.VariantsCallback() {
            @Override
            public void onSuccess(List<String> items) {
                runOnUiThread(() -> {
                    showProgress(false);
                    populateEntries(items);
                });
            }

            @Override
            public void onFailure(String message) {
                runOnUiThread(() -> {
                    showProgress(false);
                    emptyState.setText("Failed to load variants");
                    emptyState.setVisibility(View.VISIBLE);
                    Toast.makeText(IrdCsvSelectionActivity.this, "Unable to load variants: " + message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void populateEntries(@NonNull List<String> data) {
        variants.clear();
        variants.addAll(data);
        adapter.clear();
        adapter.addAll(variants);
        adapter.notifyDataSetChanged();

        if (variants.isEmpty()) {
            emptyState.setText("No variants available");
            emptyState.setVisibility(View.VISIBLE);
        }
    }

    private void importWavelet(String fileName) {
        showProgress(true);
        String accessToken = authenticationManager.getAccessToken();
        backendClient.importRemote(accessToken, brand, remote, fileName, new IrdBackendClient.ImportCallback() {
            @Override
            public void onProgress(int processed, int total) {
                runOnUiThread(() -> {
                    showProgress(false);
                    updateImportProgress(processed, total);
                });
            }

            @Override
            public void onSuccess(IrdBackendClient.ImportedWavelet wavelet) {
                runOnUiThread(() -> {
                    showProgress(false);
                    dismissImportProgressDialog();
                    Intent result = new Intent();
                    result.putExtra(EXTRA_SCRIPT_NAME, wavelet.getName());
                    result.putExtra(EXTRA_SCRIPT_CONTENT, wavelet.getContent());
                    result.putExtra(EXTRA_SCRIPT_METADATA, wavelet.getMetadataJson());
                    setResult(RESULT_OK, result);
                    finish();
                });
            }

            @Override
            public void onFailure(String message) {
                runOnUiThread(() -> {
                    showProgress(false);
                    dismissImportProgressDialog();
                    Toast.makeText(IrdCsvSelectionActivity.this, "Failed to import remote: " + message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void showProgress(boolean show) {
        progressBar.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void updateImportProgress(int processed, int total) {
        if (importProgressDialog == null) {
            LayoutInflater inflater = LayoutInflater.from(this);
            View dialogView = inflater.inflate(R.layout.dialog_import_progress, null);
            importProgressBar = dialogView.findViewById(R.id.import_progress_bar);
            importProgressText = dialogView.findViewById(R.id.import_progress_text);
            importProgressDialog = new AlertDialog.Builder(this)
                .setTitle("Importing Remote")
                .setView(dialogView)
                .setCancelable(false)
                .create();
            importProgressDialog.show();
        } else if (!importProgressDialog.isShowing()) {
            importProgressDialog.show();
        }

        if (importProgressBar == null || importProgressText == null) {
            return;
        }

        if (total > 0) {
            importProgressBar.setIndeterminate(false);
            importProgressBar.setMax(total);
            importProgressBar.setProgress(Math.min(processed, total));
            importProgressText.setText(String.format(Locale.US, "%d / %d", processed, total));
        } else {
            importProgressBar.setIndeterminate(true);
            importProgressText.setText("Processing…");
        }
    }

    private void dismissImportProgressDialog() {
        if (importProgressDialog != null && importProgressDialog.isShowing()) {
            importProgressDialog.dismiss();
        }
    }

    @Override
    protected void onDestroy() {
        dismissImportProgressDialog();
        super.onDestroy();
    }
}
