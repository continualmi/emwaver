package com.emwaver.emwaverandroidapp.ui.wavelets.irdb;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.emwaver.emwaverandroidapp.wavelets.IrdBackendClient;
import com.emwaver.emwaverandroidapp.wavelets.IrdBackendClient.RemoteSummary;
import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.util.List;

public class IrdRemoteSelectionActivity extends AppCompatActivity {

    private static final String EXTRA_BRAND = "extra_brand";

    public static Intent createIntent(Context context, String brand) {
        Intent intent = new Intent(context, IrdRemoteSelectionActivity.class);
        intent.putExtra(EXTRA_BRAND, brand);
        return intent;
    }

    private final ActivityResultLauncher<Intent> csvPickerLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                setResult(RESULT_OK, result.getData());
                finish();
            }
        });

    private String brand;
    private ProgressBar progressBar;
    private TextView emptyState;
    private ListView listView;
    private TextInputEditText searchInput;
    private RemoteAdapter adapter;
    private final List<RemoteSummary> remotes = new ArrayList<>();
    private IrdBackendClient backendClient;
    private AuthenticationManager authenticationManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_irdb_list);
        brand = getIntent().getStringExtra(EXTRA_BRAND);
        if (TextUtils.isEmpty(brand)) {
            Toast.makeText(this, "Missing brand", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        backendClient = new IrdBackendClient();
        authenticationManager = AuthenticationManager.getInstance(this);
        setupToolbar();
        initViews();
        setupList();
        loadRemotes();
    }

    private void setupToolbar() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setTitle("Select Remote");
        setSupportActionBar(toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
            getSupportActionBar().setDisplayShowHomeEnabled(true);
            getSupportActionBar().setSubtitle(brand);
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
            layout.setHint("Search remotes");
        }
        listView.setEmptyView(emptyState);
    }

    private void setupList() {
        adapter = new RemoteAdapter(this, remotes);
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            RemoteSummary remote = adapter.getItem(position);
            if (remote != null) {
                Intent intent = IrdCsvSelectionActivity.createIntent(this, brand, remote.getName());
                csvPickerLauncher.launch(intent);
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

    private void loadRemotes() {
        showProgress(true);
        emptyState.setVisibility(View.GONE);
        String accessToken = authenticationManager.getAccessToken();
        backendClient.fetchRemotes(accessToken, brand, new IrdBackendClient.RemotesCallback() {
            @Override
            public void onSuccess(List<RemoteSummary> result) {
                runOnUiThread(() -> {
                    showProgress(false);
                    populateRemotes(result);
                });
            }

            @Override
            public void onFailure(String message) {
                runOnUiThread(() -> {
                    showProgress(false);
                    emptyState.setText("Failed to load remotes");
                    emptyState.setVisibility(View.VISIBLE);
                    Toast.makeText(IrdRemoteSelectionActivity.this, "Unable to load remotes: " + message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void populateRemotes(List<RemoteSummary> items) {
        remotes.clear();
        remotes.addAll(items);

        adapter.clear();
        adapter.addAll(remotes);
        adapter.notifyDataSetChanged();

        if (remotes.isEmpty()) {
            emptyState.setText("No remotes available");
            emptyState.setVisibility(View.VISIBLE);
        }
    }

    private void showProgress(boolean show) {
        progressBar.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private static class RemoteAdapter extends ArrayAdapter<RemoteSummary> {

        RemoteAdapter(@NonNull Context context, @NonNull List<RemoteSummary> items) {
            super(context, android.R.layout.simple_list_item_2, android.R.id.text1, new ArrayList<>(items));
        }

        @NonNull
        @Override
        public View getView(int position, View convertView, @NonNull android.view.ViewGroup parent) {
            View view = super.getView(position, convertView, parent);
            TextView primary = view.findViewById(android.R.id.text1);
            TextView secondary = view.findViewById(android.R.id.text2);
            RemoteSummary remote = getItem(position);
            if (remote != null) {
                primary.setText(remote.getName());
                secondary.setText(remote.getVariantCount() + (remote.getVariantCount() == 1 ? " configuration" : " configurations"));
            }
            return view;
        }
    }
}
