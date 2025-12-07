package com.emwaver.emwaverandroidapp.ui.wavelets.irdb;

import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.emwaver.emwaverandroidapp.wavelets.IrdBackendClient;
import com.google.android.material.appbar.MaterialToolbar;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.util.List;

public class IrdBrandSelectionActivity extends AppCompatActivity {

    private final ActivityResultLauncher<Intent> remotePickerLauncher =
        registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == RESULT_OK && result.getData() != null) {
                setResult(RESULT_OK, result.getData());
                finish();
            }
        });

    private ProgressBar progressBar;
    private TextView emptyStateView;
    private ListView listView;
    private TextInputEditText searchInput;
    private ArrayAdapter<String> adapter;
    private final List<String> brands = new ArrayList<>();
    private IrdBackendClient backendClient;
    private AuthenticationManager authenticationManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_irdb_list);
        backendClient = new IrdBackendClient();
        authenticationManager = AuthenticationManager.getInstance(this);
        setupToolbar();
        initViews();
        setupList();
        loadBrands();
    }

    private void setupToolbar() {
        MaterialToolbar toolbar = findViewById(R.id.toolbar);
        toolbar.setTitle("Select Brand");
        setSupportActionBar(toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
            getSupportActionBar().setDisplayShowHomeEnabled(true);
        }
        toolbar.setNavigationOnClickListener(v -> finish());
    }

    private void initViews() {
        progressBar = findViewById(R.id.progress);
        emptyStateView = findViewById(R.id.empty_state);
        listView = findViewById(R.id.list_view);
        searchInput = findViewById(R.id.search_input);
        TextInputLayout searchLayout = findViewById(R.id.search_input_layout);
        if (searchLayout != null) {
            searchLayout.setHint("Search brands");
        }
        listView.setEmptyView(emptyStateView);
    }

    private void setupList() {
        adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, android.R.id.text1, new ArrayList<>());
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> {
            String brand = adapter.getItem(position);
            if (brand != null) {
                Intent intent = IrdRemoteSelectionActivity.createIntent(this, brand);
                remotePickerLauncher.launch(intent);
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

    private void loadBrands() {
        showProgress(true);
        emptyStateView.setVisibility(View.GONE);
        String accessToken = authenticationManager.getAccessToken();
        backendClient.fetchBrands(accessToken, new IrdBackendClient.BrandsCallback() {
            @Override
            public void onSuccess(List<String> result) {
                runOnUiThread(() -> {
                    showProgress(false);
                    populateBrands(result);
                });
            }

            @Override
            public void onFailure(String message) {
                runOnUiThread(() -> {
                    showProgress(false);
                    showError(message);
                });
            }
        });
    }

    private void populateBrands(List<String> items) {
        brands.clear();
        brands.addAll(items);

        adapter.clear();
        adapter.addAll(brands);
        adapter.notifyDataSetChanged();

        if (brands.isEmpty()) {
            emptyStateView.setText("No brands found");
            emptyStateView.setVisibility(View.VISIBLE);
        }
    }

    private void showError(String message) {
        emptyStateView.setText("Failed to load brands");
        emptyStateView.setVisibility(View.VISIBLE);
        Toast.makeText(this, "Unable to load brands: " + message, Toast.LENGTH_LONG).show();
    }

    private void showProgress(boolean show) {
        progressBar.setVisibility(show ? View.VISIBLE : View.GONE);
    }
}
