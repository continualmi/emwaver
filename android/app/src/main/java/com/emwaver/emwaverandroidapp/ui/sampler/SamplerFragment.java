package com.emwaver.emwaverandroidapp.ui.sampler;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.preference.PreferenceManager;
import android.provider.OpenableColumns;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentSamplerBinding;
import com.emwaver.emwaverandroidapp.auth.AuthenticationManager;
import com.emwaver.emwaverandroidapp.files.FileRepository;
import com.emwaver.emwaverandroidapp.files.RepositoryCallback;
import com.emwaver.emwaverandroidapp.files.UserFileData;
import com.emwaver.emwaverandroidapp.files.UserFileMetadata;
import com.emwaver.emwaverandroidapp.infrared.InfraredRepository;
import com.github.mikephil.charting.charts.LineChart;
import com.github.mikephil.charting.components.XAxis;
import com.github.mikephil.charting.components.YAxis;
import com.github.mikephil.charting.data.Entry;
import com.github.mikephil.charting.data.LineData;
import com.github.mikephil.charting.data.LineDataSet;
import com.github.mikephil.charting.listener.ChartTouchListener;
import com.github.mikephil.charting.listener.OnChartGestureListener;
import com.google.android.material.textfield.TextInputEditText;
import com.google.android.material.textfield.TextInputLayout;

import java.util.ArrayList;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class SamplerFragment extends Fragment {

    private SamplerViewModel rawModeViewModel;
    private FragmentSamplerBinding binding;
    private static com.emwaver.emwaverandroidapp.BLEService BLEService;
    LineChart chart = null;
    private int chartMinX = 0;
    private int chartMaxX = 10000;
    private boolean isServiceBound = false;
    private float currentZoomLevel = 1.0f;
    private int prevRangeStart = 0;
    private int prevRangeEnd = 0;
    private int visiblePoints = 300;
    private int lastBufferSize = 0;
    private boolean isRecording = false;
    private boolean forceRefresh = true;
    private int refreshDelay = 50; // Default, will be loaded from preferences
    private int bufferSizeLimit = 393216; // Default to ~30 seconds at 10μs per sample, will be loaded from preferences
    private boolean schedulerRunning = false;
    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private final Runnable refreshRunnable = new Runnable() {
        @Override
        public void run() {
            // Perform the refresh
            refreshChart();
            
            // Calculate time for next refresh
            long currentTime = System.currentTimeMillis();
            long processingTime = System.currentTimeMillis() - currentTime; // This will be 0, but kept for structure
            long timeToNextRefresh = Math.max(1, refreshDelay - processingTime);
            
            // Schedule the next refresh if still running
            if (schedulerRunning) {
                refreshHandler.postDelayed(this, timeToNextRefresh);
            }
        }
    };

    // Add PINS array to match UsbFragment
    private static final String[] PINS = {
            "GPIO0 (IO0)",
            "CC1101 GDO0 (IO1)",
            "CC1101 GDO2 (IO2)",
            
            "IR TX (IO4)",
            "IR RX (IO5)",
            "GPIO6 (IO6)",      // Schematic shows GPIO6 with overbar
            "GPIO7 (IO7)",

            "GPIO9 (IO9)",
            "CC1101 NSS (IO10)", // SPI Chip Select
            "CC1101 MOSI (IO11)",// SPI MOSI
            "CC1101 SCK (IO12)", // SPI SCK
            "CC1101 MISO (IO13)",// SPI MISO
            "GPIO14 (IO14)",
            "GPIO15 (IO15)",
            "GPIO16 (IO16)"
    };

    private static final String PREF_SELECTED_PIN_INDEX = "selectedSamplerPinIndex";

    private FileRepository fileRepository;
    private InfraredRepository infraredRepository;
    private AuthenticationManager authenticationManager;
    private ActivityResultLauncher<String[]> openRawFileLauncher;
    private ActivityResultLauncher<String> createRawFileLauncher;
    private UserFileMetadata currentSignalMetadata;
    private String currentSignalName;
    private boolean hasUnsavedChanges;
    private boolean isLoadingSignalList;
    private boolean isSavingSignal;
    private byte[] pendingExportBuffer;
    private String pendingExportDisplayName;
    private final List<UserFileMetadata> signalFiles = new ArrayList<>();
    private SignalsAdapter signalAdapter;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            BLEService = binder.getService();
            isServiceBound = true;
            Log.i("service binding", "onServiceConnected");
            initChart();
            refreshChart(); // Refresh the chart with the new buffer
        }
        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.i("service binding", "onServiceDisconnected");
        }
    };

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openRawFileLauncher = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                if (uri != null) {
                    importSignalFromUri(uri);
                }
            }
        );
        createRawFileLauncher = registerForActivityResult(
            new ActivityResultContracts.CreateDocument("application/octet-stream"),
            uri -> {
                if (uri != null) {
                    exportPendingBufferToUri(uri);
                } else {
                    clearPendingExport();
                }
            }
        );
    }

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {

        // Initialize view binding
        binding = FragmentSamplerBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        fileRepository = FileRepository.getInstance(requireContext());
        infraredRepository = InfraredRepository.getInstance(requireContext());
        authenticationManager = AuthenticationManager.getInstance(requireContext());
        chart = binding.chart;

        signalAdapter = new SignalsAdapter(metadata -> loadSignalFromCloud(metadata));
        binding.signalList.setLayoutManager(new LinearLayoutManager(requireContext()));
        binding.signalList.setAdapter(signalAdapter);
        binding.signalListRefreshButton.setOnClickListener(v -> refreshSignalList());
        binding.signalSaveButton.setOnClickListener(v -> saveSignalToCloud());

        if (binding.irpProtocolEditText != null && TextUtils.isEmpty(getInputText(binding.irpProtocolEditText))) {
            binding.irpProtocolEditText.setText("NEC1");
        }
        if (binding.irpDeviceEditText != null && TextUtils.isEmpty(getInputText(binding.irpDeviceEditText))) {
            binding.irpDeviceEditText.setText("0");
        }
        if (binding.irpSubdeviceEditText != null && TextUtils.isEmpty(getInputText(binding.irpSubdeviceEditText))) {
            binding.irpSubdeviceEditText.setText("0");
        }
        if (binding.irpFunctionEditText != null && TextUtils.isEmpty(getInputText(binding.irpFunctionEditText))) {
            binding.irpFunctionEditText.setText("170");
        }

        // Replace the resource-based spinner adapter with the PINS array
        ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(),
                android.R.layout.simple_spinner_item, PINS);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.gpioSpinner.setAdapter(adapter);

        // Load saved pin selection or set default
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        int defaultPinIndex = 6; // GPIO6 (IO6)
        int selectedPinIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX, defaultPinIndex);
        if (selectedPinIndex >= 0 && selectedPinIndex < adapter.getCount()) {
            binding.gpioSpinner.setSelection(selectedPinIndex);
        } else {
            binding.gpioSpinner.setSelection(defaultPinIndex); // Fallback to default
        }

        binding.gpioSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String selectedPin = parent.getItemAtPosition(position).toString();
                // Show retransmit button for all pins
                binding.retransmitButton.setVisibility(View.VISIBLE);

                // Save the selected pin index
                SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
                SharedPreferences.Editor editor = prefs.edit();
                editor.putInt(PREF_SELECTED_PIN_INDEX, position);
                editor.apply();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                binding.retransmitButton.setVisibility(View.GONE);
            }
        });

        binding.recordButton.setOnClickListener(v -> startRecording());
        binding.stopButton.setOnClickListener(v -> stopRecording());
        binding.retransmitButton.setOnClickListener(v -> retransmitSignal());
        binding.getTimingsButton.setOnClickListener(v -> getTimings());
        binding.invertSignalButton.setOnClickListener(v -> convertToIR());
        binding.decodeIrpButton.setOnClickListener(v -> decodeIrp());
        binding.renderIrpButton.setOnClickListener(v -> renderIrp());
        
        // Initially disable the stop button as we're not recording yet
        binding.stopButton.setEnabled(false);
        
        rawModeViewModel = new ViewModelProvider(this).get(SamplerViewModel.class);

        Runtime runtime = Runtime.getRuntime();
        long maxHeapSize = runtime.maxMemory(); // Returns the maximum heap size in bytes
        Log.i("heap", maxHeapSize+"");

        chart.setOnChartGestureListener(new OnChartGestureListener() {
            //region useless chart listeners

            @Override
            public void onChartGestureStart(MotionEvent me, ChartTouchListener.ChartGesture lastPerformedGesture) {

            }

            @Override
            public void onChartGestureEnd(MotionEvent me, ChartTouchListener.ChartGesture lastPerformedGesture) {

            }

            @Override
            public void onChartLongPressed(MotionEvent me) {

            }

            @Override
            public void onChartDoubleTapped(MotionEvent me) {

            }

            @Override
            public void onChartSingleTapped(MotionEvent me) {

            }

            @Override
            public void onChartFling(MotionEvent me1, MotionEvent me2, float velocityX, float velocityY) {

            }
            //endregion
            @Override
            public void onChartScale(MotionEvent me, float scaleX, float scaleY) {
                float newZoomLevel = chart.getScaleX();

                if (Math.abs(newZoomLevel - currentZoomLevel) >= (newZoomLevel/10)) {
                    currentZoomLevel = newZoomLevel;

                    rawModeViewModel.setVisibleRangeStart((int) chart.getLowestVisibleX());
                    rawModeViewModel.setVisibleRangeEnd((int) chart.getHighestVisibleX());

                    // Always update the chart when zooming
                    lastBufferSize = -1; // Force refresh by making lastBufferSize different
                    updateChartWithCompression(
                        rawModeViewModel.getVisibleRangeStart(), 
                        rawModeViewModel.getVisibleRangeEnd(), 
                        visiblePoints
                    );
                }
            }
            @Override
            public void onChartTranslate(MotionEvent me, float dX, float dY) {
                int visibleRangeStart = (int) chart.getLowestVisibleX();
                int visibleRangeEnd = (int) chart.getHighestVisibleX();
                rawModeViewModel.setVisibleRangeStart(visibleRangeStart);
                rawModeViewModel.setVisibleRangeEnd(visibleRangeStart);

                int span = visibleRangeEnd - visibleRangeStart;
                float translationThreshold = (float)span / 100;

                if ((visibleRangeStart <= chartMinX && dX > 0) || (visibleRangeEnd >= chartMaxX && dX < 0)) {
                    return;
                }

                if (Math.abs(visibleRangeStart - prevRangeStart) > translationThreshold ||
                        Math.abs(visibleRangeEnd - prevRangeEnd) > translationThreshold &&
                                span >= 10 ) {

                    prevRangeStart = visibleRangeStart;
                    prevRangeEnd = visibleRangeEnd;

                    // Always update the chart when panning
                    lastBufferSize = -1; // Force refresh by making lastBufferSize different
                    updateChartWithCompression(visibleRangeStart, visibleRangeEnd, visiblePoints);
                }
            }
        });

        initScheduler();

        setupMenu();
        currentSignalMetadata = null;
        currentSignalName = defaultSignalName();
        hasUnsavedChanges = false;
        isLoadingSignalList = false;
        updateCurrentSignalUi();

        return root;
    }

    private void setupMenu() {
        MenuProvider menuProvider = new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menuInflater.inflate(R.menu.raw_mode_menu, menu);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                int id = menuItem.getItemId();
                if (id == R.id.action_clear_buffer) {
                    clearBuffer();
                    return true;
                } else if (id == R.id.action_new_signal) {
                    createNewSignal();
                    return true;
                } else if (id == R.id.action_rename_signal) {
                    renameSignal();
                    return true;
                } else if (id == R.id.action_delete_signal) {
                    deleteSignal();
                    return true;
                } else if (id == R.id.action_load_from_storage) {
                    selectSignalFromExternalStorage();
                    return true;
                } else if (id == R.id.action_save_to_storage) {
                    saveCurrentBufferToExternal();
                    return true;
                }
                return false;
            }
        };

        requireActivity().addMenuProvider(menuProvider, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void clearBuffer() {
        if (BLEService != null) {
            BLEService.clearBuffer();
            lastBufferSize = -1; // Force refresh
            refreshChart(); // Refresh the chart to reflect the cleared buffer
            markBufferDirty(false, null);
        } else {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
        }
    }

    private void selectSignalFromExternalStorage() {
        if (openRawFileLauncher == null) {
            return;
        }
        openRawFileLauncher.launch(new String[]{"application/octet-stream", "*/*"});
    }

    private void saveCurrentBufferToExternal() {
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        byte[] buffer = BLEService.getBuffer();
        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }
        pendingExportBuffer = buffer.clone();
        String exportName = !TextUtils.isEmpty(currentSignalName) ? currentSignalName : defaultSignalName();
        pendingExportDisplayName = normalizeSignalName(exportName);
        if (createRawFileLauncher != null) {
            createRawFileLauncher.launch(pendingExportDisplayName);
        }
    }

    private void saveSignalToCloud() {
        if (!isAdded()) {
            return;
        }
        if (!hasUnsavedChanges || isSavingSignal) {
            return;
        }
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        byte[] buffer = BLEService.getBuffer();
        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }
        boolean isAuthenticated = authenticationManager != null && !TextUtils.isEmpty(authenticationManager.getAccessToken());
        if (!isAuthenticated) {
            Toast.makeText(requireContext(), "Sign in to save signals", Toast.LENGTH_SHORT).show();
            return;
        }

        final byte[] payload = buffer.clone();
        if (currentSignalMetadata == null) {
            promptForSignalName(payload);
        } else {
            if (TextUtils.isEmpty(currentSignalMetadata.getEtag())) {
                Toast.makeText(requireContext(), "Reload signal before saving changes", Toast.LENGTH_SHORT).show();
                return;
            }
            updateSignalInCloud(currentSignalMetadata, payload);
        }
    }

    private void promptForSignalName(byte[] data) {
        if (!isAdded()) {
            return;
        }
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Save Signal");
        builder.setMessage("Enter a name for the signal:");
        final EditText input = new EditText(requireContext());
        String defaultName = !TextUtils.isEmpty(currentSignalName) ? currentSignalName : defaultSignalName();
        input.setText(defaultName);
        input.setSelection(defaultName.length());
        builder.setView(input);
        builder.setPositiveButton("Save", (dialog, which) -> {
            String entered = input.getText() != null ? input.getText().toString().trim() : "";
            if (TextUtils.isEmpty(entered)) {
                entered = defaultSignalName();
            }
            String normalized = normalizeSignalName(entered);
            currentSignalName = normalized;
            updateCurrentSignalUi();
            createSignalInCloud(normalized, data);
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> {
            isSavingSignal = false;
            updateCurrentSignalUi();
        });
        builder.setOnCancelListener(dialog -> {
            isSavingSignal = false;
            updateCurrentSignalUi();
        });
        builder.show();
    }

    private void createSignalInCloud(String name, byte[] data) {
        if (!isAdded()) {
            return;
        }
        if (fileRepository == null) {
            showToastOnUiThread("Storage not available");
            return;
        }
        isSavingSignal = true;
        updateCurrentSignalUi();
        final String normalizedName = normalizeSignalName(name);
        fileRepository.createBinaryFile(normalizedName, data, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata value) {
                isSavingSignal = false;
                markBufferClean(value);
                showToastOnUiThread("Signal saved to cloud");
                refreshSignalList();
            }

            @Override
            public void onError(String message) {
                isSavingSignal = false;
                updateCurrentSignalUi();
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to save signal" : message);
            }
        });
    }

    private void updateSignalInCloud(UserFileMetadata metadata, byte[] data) {
        if (!isAdded()) {
            return;
        }
        if (fileRepository == null) {
            showToastOnUiThread("Storage not available");
            return;
        }
        String etag = metadata.getEtag();
        if (TextUtils.isEmpty(etag)) {
            showToastOnUiThread("Reload signal before saving changes");
            return;
        }
        isSavingSignal = true;
        updateCurrentSignalUi();
        fileRepository.updateBinaryFile(metadata.getId(), etag, data, new RepositoryCallback<UserFileMetadata>() {
            @Override
            public void onSuccess(UserFileMetadata value) {
                isSavingSignal = false;
                markBufferClean(value);
                showToastOnUiThread("Signal updated");
                refreshSignalList();
            }

            @Override
            public void onError(String message) {
                isSavingSignal = false;
                updateCurrentSignalUi();
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to save changes" : message);
            }
        });
    }

    private void importSignalFromUri(Uri uri) {
        if (!isAdded()) {
            return;
        }
        new Thread(() -> {
            try {
                byte[] data = readBytesFromUri(uri);
                if (data == null || data.length == 0) {
                    showToastOnUiThread("Selected file is empty");
                    return;
                }
                String displayName = getDisplayNameFromUri(uri);
                String normalizedName = normalizeSignalName(displayName);
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) {
                        return;
                    }
                    if (BLEService == null) {
                        Toast.makeText(requireContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    BLEService.loadBuffer(data);
                    lastBufferSize = -1;
                    refreshChart();
                    markBufferDirty(true, normalizedName);
                    Toast.makeText(requireContext(), "Signal loaded from storage", Toast.LENGTH_SHORT).show();
                });
            } catch (IOException e) {
                Log.e("SamplerFragment", "Failed to import signal", e);
                showToastOnUiThread("Failed to read signal file");
            }
        }).start();
    }

    private void exportPendingBufferToUri(Uri uri) {
        if (pendingExportBuffer == null || pendingExportBuffer.length == 0 || !isAdded()) {
            showToastOnUiThread("Nothing to save");
            clearPendingExport();
            return;
        }
        byte[] data = pendingExportBuffer;
        new Thread(() -> {
            try (OutputStream outputStream = requireContext().getContentResolver().openOutputStream(uri)) {
                if (outputStream == null) {
                    throw new IOException("Unable to open destination");
                }
                outputStream.write(data);
                outputStream.flush();
                String displayName = getDisplayNameFromUri(uri);
                if (TextUtils.isEmpty(displayName)) {
                    displayName = pendingExportDisplayName;
                }
                showToastOnUiThread("Signal saved to storage");
            } catch (IOException e) {
                Log.e("SamplerFragment", "Failed to export signal", e);
                showToastOnUiThread("Failed to save signal");
            } finally {
                clearPendingExport();
            }
        }).start();
    }

    private void clearPendingExport() {
        pendingExportBuffer = null;
        pendingExportDisplayName = null;
    }

    private byte[] readBytesFromUri(Uri uri) throws IOException {
        try (InputStream inputStream = requireContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            if (inputStream == null) {
                throw new IOException("Unable to open selected file");
            }
            byte[] chunk = new byte[8192];
            int read;
            while ((read = inputStream.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        }
    }

    private String getDisplayNameFromUri(Uri uri) {
        String result = null;
        if ("content".equals(uri.getScheme())) {
            Cursor cursor = null;
            try {
                cursor = requireContext().getContentResolver().query(uri, null, null, null, null);
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) {
                        result = cursor.getString(index);
                    }
                }
            } finally {
                if (cursor != null) {
                    cursor.close();
                }
            }
        }
        if (TextUtils.isEmpty(result)) {
            result = uri.getLastPathSegment();
        }
        return result != null ? result : defaultSignalName();
    }

    private void markBufferDirty(boolean resetMetadata, @Nullable String suggestedName) {
        if (resetMetadata) {
            currentSignalMetadata = null;
        }
        if (!TextUtils.isEmpty(suggestedName)) {
            currentSignalName = normalizeSignalName(suggestedName);
        } else if (resetMetadata && TextUtils.isEmpty(currentSignalName)) {
            currentSignalName = defaultSignalName();
        }
        hasUnsavedChanges = true;
        updateCurrentSignalUi();
    }

    private void markBufferClean(@Nullable UserFileMetadata metadata) {
        if (metadata != null) {
            currentSignalMetadata = metadata;
            currentSignalName = metadata.getName();
        }
        hasUnsavedChanges = false;
        updateCurrentSignalUi();
    }

    private void createNewSignal() {
        if (!isAdded()) {
            return;
        }
        if (BLEService == null) {
            Toast.makeText(requireContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        BLEService.clearBuffer();
        lastBufferSize = -1;
        refreshChart();
        String defaultName = generateNewSignalName();
        markBufferDirty(true, defaultName);
        Toast.makeText(requireContext(), "New signal ready", Toast.LENGTH_SHORT).show();
    }

    private void renameSignal() {
        if (!isAdded()) {
            return;
        }
        if (isSavingSignal) {
            Toast.makeText(requireContext(), "Operation in progress", Toast.LENGTH_SHORT).show();
            return;
        }
        if (currentSignalMetadata == null) {
            Toast.makeText(requireContext(), "Save the signal before renaming", Toast.LENGTH_SHORT).show();
            return;
        }
        if (hasUnsavedChanges) {
            Toast.makeText(requireContext(), "Save changes before renaming", Toast.LENGTH_SHORT).show();
            return;
        }
        final String existingName = currentSignalMetadata.getName() != null
            ? currentSignalMetadata.getName()
            : currentSignalName;
        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Rename Signal");
        builder.setMessage("Enter a new name:");
        final EditText input = new EditText(requireContext());
        String prefill = !TextUtils.isEmpty(existingName) ? existingName : defaultSignalName();
        input.setText(prefill);
        input.setSelection(prefill.length());
        builder.setView(input);
        builder.setPositiveButton("Rename", (dialog, which) -> {
            String entered = input.getText() != null ? input.getText().toString().trim() : "";
            if (TextUtils.isEmpty(entered)) {
                Toast.makeText(requireContext(), "Name cannot be empty", Toast.LENGTH_SHORT).show();
                return;
            }
            String normalized = normalizeSignalName(entered);
            String currentName = currentSignalMetadata.getName();
            if (currentName != null && currentName.equalsIgnoreCase(normalized)) {
                Toast.makeText(requireContext(), "Name unchanged", Toast.LENGTH_SHORT).show();
                return;
            }
            if (fileRepository == null) {
                Toast.makeText(requireContext(), "Storage not available", Toast.LENGTH_SHORT).show();
                return;
            }
            isSavingSignal = true;
            updateCurrentSignalUi();
            fileRepository.renameFile(currentSignalMetadata.getId(), normalized, new RepositoryCallback<UserFileMetadata>() {
                @Override
                public void onSuccess(UserFileMetadata value) {
                    isSavingSignal = false;
                    markBufferClean(value);
                    showToastOnUiThread("Signal renamed");
                    refreshSignalList();
                }

                @Override
                public void onError(String message) {
                    isSavingSignal = false;
                    updateCurrentSignalUi();
                    showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to rename signal" : message);
                }
            });
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void deleteSignal() {
        if (!isAdded()) {
            return;
        }
        if (isSavingSignal) {
            Toast.makeText(requireContext(), "Operation in progress", Toast.LENGTH_SHORT).show();
            return;
        }
        if (currentSignalMetadata == null) {
            Toast.makeText(requireContext(), "Nothing to delete", Toast.LENGTH_SHORT).show();
            return;
        }
        if (hasUnsavedChanges) {
            Toast.makeText(requireContext(), "Save or discard changes before deleting", Toast.LENGTH_SHORT).show();
            return;
        }
        String etag = currentSignalMetadata.getEtag();
        if (TextUtils.isEmpty(etag)) {
            Toast.makeText(requireContext(), "Reload signal before deleting", Toast.LENGTH_SHORT).show();
            return;
        }
        if (fileRepository == null) {
            Toast.makeText(requireContext(), "Storage not available", Toast.LENGTH_SHORT).show();
            return;
        }

        String signalName = currentSignalMetadata.getName() != null ? currentSignalMetadata.getName() : "this signal";
        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Signal")
            .setMessage("Delete " + signalName + " from cloud?")
            .setPositiveButton("Delete", (dialog, which) -> performDeleteSignal(currentSignalMetadata.getId(), etag))
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void performDeleteSignal(String fileId, String etag) {
        isSavingSignal = true;
        updateCurrentSignalUi();
        fileRepository.deleteFile(fileId, etag, new RepositoryCallback<Void>() {
            @Override
            public void onSuccess(Void value) {
                isSavingSignal = false;
                showToastOnUiThread("Signal deleted");
                refreshSignalList();
                markBufferDirty(true, defaultSignalName());
            }

            @Override
            public void onError(String message) {
                isSavingSignal = false;
                updateCurrentSignalUi();
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to delete signal" : message);
            }
        });
    }

    private String generateNewSignalName() {
        String base = "signal";
        int counter = 1;
        String candidate = base + counter + ".raw";
        while (signalFiles != null && containsSignalName(candidate)) {
            counter++;
            candidate = base + counter + ".raw";
        }
        return candidate;
    }

    private boolean containsSignalName(String name) {
        if (TextUtils.isEmpty(name)) {
            return false;
        }
        for (UserFileMetadata metadata : signalFiles) {
            if (metadata != null && name.equalsIgnoreCase(metadata.getName())) {
                return true;
            }
        }
        return false;
    }

    private void updateCurrentSignalUi() {
        if (!isAdded() || binding == null) {
            return;
        }
        boolean isAuthenticated = authenticationManager != null && !TextUtils.isEmpty(authenticationManager.getAccessToken());
        String name = !TextUtils.isEmpty(currentSignalName) ? currentSignalName : defaultSignalName();
        StringBuilder summary = new StringBuilder("Current signal: ").append(name);
        if (hasUnsavedChanges) {
            summary.append(" *");
        } else if (currentSignalMetadata != null) {
            summary.append(" • synced");
        }
        binding.currentSignalSummary.setText(summary.toString());

        String buttonText;
        boolean enableButton = false;
        if (isSavingSignal) {
            buttonText = "Saving...";
        } else if (!isAuthenticated) {
            buttonText = "Sign in to save";
        } else if (currentSignalMetadata == null) {
            buttonText = hasUnsavedChanges ? "Save to Cloud" : "Save to Cloud";
            enableButton = hasUnsavedChanges;
        } else {
            if (hasUnsavedChanges) {
                buttonText = "Save Changes";
                enableButton = true;
            } else {
                buttonText = "Synced";
            }
        }
        binding.signalSaveButton.setText(buttonText);
        binding.signalSaveButton.setEnabled(enableButton && !isSavingSignal && isAuthenticated);
        binding.signalSaveButton.setAlpha(binding.signalSaveButton.isEnabled() ? 1f : 0.6f);

        if (signalAdapter != null) {
            String activeId = currentSignalMetadata != null ? currentSignalMetadata.getId() : null;
            boolean dirty = hasUnsavedChanges && currentSignalMetadata != null;
            signalAdapter.setActiveSignal(activeId, dirty);
        }
    }

    private void initScheduler() {
        // Stop any existing scheduler
        stopScheduler();
        
        // Get refresh delay from preferences
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        
        String refreshDelayStr = prefs.getString("refresh_time", "50"); // Default 50ms in preferences
        
        try {
            refreshDelay = Integer.parseInt(refreshDelayStr);
        } catch (NumberFormatException e) {
            refreshDelay = 50; // Fallback default
        }
        
        // Get buffer size limit from preferences 
        String bufferSizeLimitStr = prefs.getString("buffer_size_limit", "393216"); // Default ~30 seconds
        
        try {
            bufferSizeLimit = Integer.parseInt(bufferSizeLimitStr);
        } catch (NumberFormatException e) {
            bufferSizeLimit = 393216; // Fallback to ~30 seconds
        }
        
        // Start new scheduler
        schedulerRunning = true;
        refreshHandler.post(refreshRunnable);
    }
    
    private void stopScheduler() {
        // Remove any pending refresh tasks
        schedulerRunning = false;
        refreshHandler.removeCallbacks(refreshRunnable);
    }

    private void refreshChart() {
        if (BLEService == null) {
            return;
        }

        // Get current buffer size
        int currentBufferSize = BLEService.getBufferLength();
        
        // Check if buffer size limit has been reached while recording
        if (isRecording && bufferSizeLimit > 0 && currentBufferSize >= bufferSizeLimit) {
            Log.i("SamplerFragment", "Buffer size limit reached: " + currentBufferSize + " bytes. Stopping recording.");
            stopRecording();
            Toast.makeText(getContext(), "Recording stopped: Buffer size limit reached. You can change this limit in Settings.", Toast.LENGTH_LONG).show();
        }
        
        // Only update if buffer size has changed or we're recording or force refresh
        if (currentBufferSize == lastBufferSize && !isRecording && !forceRefresh) {
            // Skip update if nothing has changed
            return;
        }
        
        // Reset force refresh flag
        forceRefresh = false;
        
        // Update last buffer size
        lastBufferSize = currentBufferSize;

        int visibleRangeStart = (int) chart.getLowestVisibleX();
        int visibleRangeEnd = (int) chart.getHighestVisibleX();
        rawModeViewModel.setVisibleRangeStart(visibleRangeStart);
        rawModeViewModel.setVisibleRangeEnd(visibleRangeEnd);

        chartMaxX = currentBufferSize * 8;
        XAxis xAxis = chart.getXAxis();
        xAxis.setAxisMinimum(chartMinX);
        xAxis.setAxisMaximum(chartMaxX);

        updateChartWithCompression(visibleRangeStart, visibleRangeEnd, visiblePoints);
    }

    private void startRecording() {
        if (BLEService != null) {
            String selectedPinString = binding.gpioSpinner.getSelectedItem().toString();
            byte pinNumber = getPinNumberFromSelection(selectedPinString);

            if (pinNumber == -1) { // Check if pin parsing failed
                Toast.makeText(getContext(), "Recording failed: Invalid pin selected.", Toast.LENGTH_SHORT).show();
                return; // Don't proceed
            }
            
            // Format command for ESP32 using new standard format: "sample <pin>"
            byte[] command = new byte[8]; // Increased size for "sample X"
            System.arraycopy("sample ".getBytes(), 0, command, 0, 7);
            command[7] = pinNumber; // Put the pin after the space
            BLEService.write(command);
            
            // Set recording flag
            isRecording = true;
            
            // Disable record button while recording
            binding.recordButton.setEnabled(false);
            // Enable stop button
            binding.stopButton.setEnabled(true);
            
            Toast.makeText(getContext(), "Recording started on " + selectedPinString, Toast.LENGTH_SHORT).show();
        }
    }

    private void stopRecording() {
        if (BLEService != null) {
            // Use new standard "stop" command instead of "s"
            byte[] command = "stop".getBytes();
            BLEService.write(command);
            
            // Clear recording flag
            isRecording = false;
            
            // Re-enable record button
            binding.recordButton.setEnabled(true);
            // Disable stop button
            binding.stopButton.setEnabled(false);
            
            Toast.makeText(getContext(), "Recording stopped", Toast.LENGTH_SHORT).show();
            markBufferDirty(true, defaultSignalName());
        }
    }

    private void retransmitSignal() {
        int bufferLength = BLEService.getBufferLength();
        Log.d("SamplerFragment", "BEFORE_RETRANSMIT: Buffer contains " + bufferLength + 
              " bytes = " + (bufferLength * 8) + " bits");
          
        String selectedPinString = binding.gpioSpinner.getSelectedItem().toString();
        byte pinNumber = getPinNumberFromSelection(selectedPinString);

        if (pinNumber == -1) { // Check if pin parsing failed
            Toast.makeText(getContext(), "Retransmit failed: Invalid pin selected.", Toast.LENGTH_SHORT).show();
            return; // Don't proceed
        }
        
        // Format command for ESP32 using new standard format: "transmit <pin>"
        byte[] commandBytes = new byte[10]; // Increased size for "transmit X"
        System.arraycopy("transmit ".getBytes(), 0, commandBytes, 0, 9);
        commandBytes[9] = pinNumber;
        BLEService.write(commandBytes);

        // Now call the transmitBuffer method
        BLEService.transmitBuffer();
        
        // Log buffer state after transmission
        int postTransmitLength = BLEService.getBufferLength();
        Log.d("SamplerFragment", "AFTER_RETRANSMIT: Buffer contains " + postTransmitLength + 
              " bytes = " + (postTransmitLength * 8) + " bits");

        Toast.makeText(getContext(), "Retransmitting " + bufferLength + " samples on " + selectedPinString, Toast.LENGTH_SHORT).show();
    }

    public void initChart() {
        if (chart == null || !isAdded()) {
            return;
        }

        // Configure the chart (optional, based on your needs)
        chart.getDescription().setEnabled(false);
        chart.setTouchEnabled(true);
        chart.setPinchZoom(true);
        chart.setScaleYEnabled(false); // Disable Y-axis scaling
        chart.setScaleXEnabled(true);  // Enable X-axis scaling
        chart.setDrawGridBackground(false);
        int textColor = ContextCompat.getColor(requireContext(), R.color.textPrimary);
        int secondaryTextColor = ContextCompat.getColor(requireContext(), R.color.textSecondary);
        int gridColor = ContextCompat.getColor(requireContext(), R.color.surfaceMuted);
        int surfaceColor = ContextCompat.getColor(requireContext(), R.color.surfaceCard);

        chart.setNoDataTextColor(textColor);
        chart.setBackgroundColor(surfaceColor);
        chart.getLegend().setTextColor(textColor);

        XAxis xAxis = chart.getXAxis();
        xAxis.setAxisMinimum(chartMinX); // Start at 0 microseconds
        xAxis.setAxisMaximum(chartMaxX); // End at the maximum X value
        xAxis.setTextColor(textColor);
        xAxis.setAxisLineColor(textColor);
        xAxis.setGridColor(gridColor);
        xAxis.setPosition(XAxis.XAxisPosition.BOTTOM);

        YAxis leftAxis = chart.getAxisLeft();
        leftAxis.setAxisMinimum(-128); // Set minimum value for the left Y-axis
        leftAxis.setAxisMaximum(256+128); // Set maximum value for the left Y-axis
        leftAxis.setTextColor(textColor);
        leftAxis.setAxisLineColor(textColor);
        leftAxis.setGridColor(gridColor);
        leftAxis.setZeroLineColor(secondaryTextColor);

        YAxis rightAxis = chart.getAxisRight();
        rightAxis.setEnabled(false); // This will hide the right Y-axis
    }

    private LineDataSet compressDataAndGetDataSet(int rangeStart, int rangeEnd, int numberBins) {
        // Call the native method to get compressed data
        Object[] result = (Object[]) BLEService.compressDataBits(rangeStart, rangeEnd, numberBins);

        float[] timeValues = (float[]) result[0];
        float[] dataValues = (float[]) result[1];

        List<Entry> entries = new ArrayList<>();
        boolean pulseStarted = false;
        int pulseStartIndex = -1;
        int transitionCount = 0;
        int pulseLength = 0;

        for (int i = 0; i < dataValues.length; i++) {
            entries.add(new Entry(timeValues[i], dataValues[i]));

            // Detect transitions
            if (!pulseStarted && dataValues[i] == 255) { // Transition from 0 to 255
                pulseStarted = true;
                pulseStartIndex = i;
                transitionCount++;
            } else if (pulseStarted && dataValues[i] == 0 && (i == 0 || dataValues[i-1] == 255)) { // Transition from 255 to 0
                pulseLength = i - pulseStartIndex;
                transitionCount++;
            }
        }

        // Prepare the dataset
        LineDataSet lineDataSet = new LineDataSet(entries, "Signal");
        lineDataSet.setDrawValues(false);
        lineDataSet.setLineWidth(3f);
        Context context = getContext();
        int accentColor = Color.parseColor("#01579B");
        int accentDark = Color.parseColor("#004C8C");
        if (context == null && chart != null) {
            context = chart.getContext();
        }
        if (context != null) {
            accentColor = ContextCompat.getColor(context, R.color.accentBlue);
            accentDark = ContextCompat.getColor(context, R.color.accentBlueDark);
        }
        lineDataSet.setColor(accentColor);
        lineDataSet.setCircleColor(accentColor);
        lineDataSet.setHighLightColor(accentDark);
        lineDataSet.setDrawCircles(false);

        // If there is exactly one pulse (two transitions), update the legend
        if (transitionCount == 2) {
            lineDataSet.setLabel("Pulse Length: " + pulseLength + " samples");
        }

        return lineDataSet;
    }

    private void updateChart(LineDataSet lineDataSet) {
        long startTime = System.currentTimeMillis();
        
        LineData lineData = new LineData(lineDataSet);
        chart.setData(lineData);
        chart.notifyDataSetChanged();
        
        long beforeInvalidate = System.currentTimeMillis();
        Log.d("SamplerFragment", "Chart data set in " + (beforeInvalidate - startTime) + "ms");
        
        chart.invalidate();
        
        Log.d("SamplerFragment", "Chart invalidate took " + (System.currentTimeMillis() - beforeInvalidate) + "ms");
    }

    private void updateChartWithCompression(int visibleRangeStart, int visibleRangeEnd, int points) {
        // Execute immediately on a background thread
        new Thread(() -> {
            final LineDataSet compressedData = compressDataAndGetDataSet(visibleRangeStart, visibleRangeEnd, points);
            
            // Update chart on main thread
            refreshHandler.post(() -> {
                updateChart(compressedData);
            });
        }).start();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (!isServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), BLEService.class);
            getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        }
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null; // Important for avoiding memory leaks
    }
    @Override
    public void onResume() {
        super.onResume();
        
        // Initialize scheduler with the latest settings
        initScheduler();
        
        // Force a refresh to make sure we're showing current data
        forceRefresh();

        refreshSignalList();
        
        // Update UI based on recording state
        binding.recordButton.setEnabled(!isRecording);
        binding.stopButton.setEnabled(isRecording);
    }
    @Override
    public void onPause() {
        super.onPause();
        stopScheduler();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopScheduler();
    }

    private String defaultSignalName() {
        return "capture.raw";
    }

    private void loadSignalFromCloud(UserFileMetadata metadata) {
        if (fileRepository == null) {
            showToastOnUiThread("Not authenticated");
            return;
        }
        if (binding != null) {
            binding.signalListProgress.setVisibility(View.VISIBLE);
        }
        fileRepository.getFile(metadata.getId(), new RepositoryCallback<UserFileData>() {
            @Override
            public void onSuccess(UserFileData value) {
                if (!isAdded()) {
                    return;
                }
                if (binding != null) {
                    binding.signalListProgress.setVisibility(View.GONE);
                }
                byte[] data = value.hasBinaryContent() ? value.getBinaryContent() : null;
                if (data == null || data.length == 0) {
                    showToastOnUiThread("Signal file is empty");
                    return;
                }
                if (BLEService == null) {
                    showToastOnUiThread("BLE Service not available");
                    return;
                }
                BLEService.loadBuffer(data);
                lastBufferSize = -1;
                refreshChart();
                markBufferClean(value.getMetadata());
                showToastOnUiThread("Signal loaded");
            }

            @Override
            public void onError(String message) {
                if (!isAdded()) {
                    return;
                }
                if (binding != null) {
                    binding.signalListProgress.setVisibility(View.GONE);
                }
                showToastOnUiThread(message != null ? message : "Failed to download signal");
            }
        });
    }

    private void refreshSignalList() {
        if (!isAdded() || binding == null) {
            return;
        }
        if (isLoadingSignalList) {
            return;
        }

        boolean isAuthenticated = authenticationManager != null && !TextUtils.isEmpty(authenticationManager.getAccessToken());
        if (!isAuthenticated) {
            binding.signalListProgress.setVisibility(View.GONE);
            binding.signalList.setVisibility(View.GONE);
            binding.signalListEmpty.setText("Sign in to access saved signals");
            binding.signalListEmpty.setVisibility(View.VISIBLE);
            updateCurrentSignalUi();
            return;
        }

        isLoadingSignalList = true;
        binding.signalListProgress.setVisibility(View.VISIBLE);
        binding.signalListEmpty.setVisibility(View.GONE);
        binding.signalList.setVisibility(View.GONE);

        fileRepository.listFiles(".raw", new RepositoryCallback<List<UserFileMetadata>>() {
            @Override
            public void onSuccess(List<UserFileMetadata> value) {
                if (!isAdded() || binding == null) {
                    isLoadingSignalList = false;
                    return;
                }
                binding.signalListProgress.setVisibility(View.GONE);
                signalFiles.clear();
                if (value != null) {
                    signalFiles.addAll(value);
                }
                Collections.sort(signalFiles, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
                if (signalFiles.isEmpty()) {
                    binding.signalListEmpty.setText("No signals saved yet");
                    binding.signalListEmpty.setVisibility(View.VISIBLE);
                    binding.signalList.setVisibility(View.GONE);
                } else {
                    signalAdapter.setSignals(signalFiles);
                    binding.signalListEmpty.setVisibility(View.GONE);
                    binding.signalList.setVisibility(View.VISIBLE);
                }
                isLoadingSignalList = false;
                updateCurrentSignalUi();
            }

            @Override
            public void onError(String message) {
                if (!isAdded() || binding == null) {
                    isLoadingSignalList = false;
                    return;
                }
                binding.signalListProgress.setVisibility(View.GONE);
                binding.signalList.setVisibility(View.GONE);
                binding.signalListEmpty.setText(TextUtils.isEmpty(message) ? "Failed to load signals" : message);
                binding.signalListEmpty.setVisibility(View.VISIBLE);
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to load signals" : message);
                isLoadingSignalList = false;
            }
        });
    }

    private String normalizeSignalName(String rawName) {
        String name = rawName != null ? rawName.trim() : "";
        if (name.isEmpty()) {
            name = "signal.raw";
        }
        if (!name.toLowerCase(Locale.US).endsWith(".raw")) {
            name = name + ".raw";
        }
        return name;
    }

    private void showToastOnUiThread(String message) {
        if (!isAdded()) {
            return;
        }
        requireActivity().runOnUiThread(() -> Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show());
    }

    private String buildSignedRawTimings(byte[] bufferData) {
        if (bufferData == null || bufferData.length == 0) {
            return "";
        }

        StringBuilder timings = new StringBuilder();
        boolean currentState = (bufferData[0] & 0x01) != 0;
        int count = 0;
        int totalBits = bufferData.length * 8;

        for (int i = 0; i < totalBits; i++) {
            int byteIndex = i / 8;
            int bitIndex = i % 8;
            boolean bit = ((bufferData[byteIndex] >> bitIndex) & 1) != 0;

            if (bit == currentState) {
                count++;
            } else {
                appendTiming(timings, currentState, count);
                currentState = bit;
                count = 1;
            }
        }

        appendTiming(timings, currentState, count);

        return timings.toString().trim();
    }

    private void appendTiming(StringBuilder builder, boolean state, int count) {
        if (count <= 0) {
            return;
        }
        int microseconds = count * 10;
        if (!state) {
            builder.append('-');
        }
        builder.append(microseconds).append(' ');
    }

    private void getTimings() {
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        byte[] bufferData = BLEService.getBuffer();
        if (bufferData == null || bufferData.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }

        String timings = buildSignedRawTimings(bufferData);
        if (TextUtils.isEmpty(timings)) {
            Toast.makeText(getContext(), "Unable to compute timings", Toast.LENGTH_SHORT).show();
            return;
        }

        if (binding != null) {
            binding.timingsEditText.setText(timings);
        }
        showTimingsDialog(timings);
    }

    private void decodeIrp() {
        if (infraredRepository == null) {
            Toast.makeText(getContext(), "Infrared service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        byte[] buffer = BLEService.getBuffer();
        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }

        String timings = buildSignedRawTimings(buffer);
        if (TextUtils.isEmpty(timings)) {
            Toast.makeText(getContext(), "Unable to compute timings", Toast.LENGTH_SHORT).show();
            return;
        }

        if (binding != null) {
            binding.decodeIrpButton.setEnabled(false);
            binding.timingsEditText.setText("Decoding IRP...");
        }

        final String payload = timings;
        infraredRepository.decodeSignedRaw(payload, false, new InfraredRepository.Callback<List<InfraredRepository.DecodeResult>>() {
            @Override
            public void onSuccess(List<InfraredRepository.DecodeResult> value) {
                if (!isAdded() || binding == null) {
                    return;
                }
                binding.decodeIrpButton.setEnabled(true);
                if (value == null || value.isEmpty()) {
                    binding.timingsEditText.setText("");
                    showToastOnUiThread("No decode results");
                    return;
                }
                String formatted = formatDecodeResults(value);
                Log.d("SamplerFragment", "IRP decode results: " + truncateForLog(formatted));
                binding.timingsEditText.setText(formatted);
            }

            @Override
            public void onError(String message) {
                if (!isAdded() || binding == null) {
                    return;
                }
                binding.decodeIrpButton.setEnabled(true);
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to decode signal" : message);
            }
        });
    }

    private String formatDecodeResults(List<InfraredRepository.DecodeResult> results) {
        if (results == null || results.isEmpty()) {
            return "";
        }
        StringBuilder builder = new StringBuilder();
        for (InfraredRepository.DecodeResult result : results) {
            if (result == null) {
                continue;
            }
            String protocol = result.getProtocol();
            if (!TextUtils.isEmpty(protocol)) {
                builder.append(protocol);
            } else {
                builder.append("Unknown Protocol");
            }
            Map<String, Object> parameters = result.getParameters();
            if (parameters != null && !parameters.isEmpty()) {
                builder.append(' ').append(formatParameters(parameters));
            }
            String raw = result.getRaw();
            if (!TextUtils.isEmpty(raw)) {
                builder.append('\n').append(raw.trim());
            }
            builder.append('\n');
        }
        return builder.toString().trim();
    }

    private String formatParameters(Map<String, Object> parameters) {
        List<Map.Entry<String, Object>> entries = new ArrayList<>(parameters.entrySet());
        Collections.sort(entries, (left, right) -> left.getKey().compareToIgnoreCase(right.getKey()));
        StringBuilder builder = new StringBuilder("{");
        for (int i = 0; i < entries.size(); i++) {
            Map.Entry<String, Object> entry = entries.get(i);
            builder.append(entry.getKey()).append('=');
            Object value = entry.getValue();
            if (value != null) {
                builder.append(value.toString());
            } else {
                builder.append("null");
            }
            if (i < entries.size() - 1) {
                builder.append(", ");
            }
        }
        builder.append('}');
        return builder.toString();
    }

    private void renderIrp() {
        if (infraredRepository == null) {
            Toast.makeText(getContext(), "Infrared service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        if (binding == null) {
            return;
        }

        binding.irpProtocolInputLayout.setError(null);
        binding.irpDeviceInputLayout.setError(null);
        binding.irpSubdeviceInputLayout.setError(null);
        binding.irpFunctionInputLayout.setError(null);

        String protocol = getInputText(binding.irpProtocolEditText);
        if (TextUtils.isEmpty(protocol)) {
            binding.irpProtocolInputLayout.setError("Required");
            return;
        }

        Map<String, Object> parameters = new HashMap<>();
        if (!applyNumericParameter(parameters, binding.irpDeviceInputLayout, "D", binding.irpDeviceEditText)) {
            return;
        }
        if (!applyNumericParameter(parameters, binding.irpSubdeviceInputLayout, "S", binding.irpSubdeviceEditText)) {
            return;
        }
        if (!applyNumericParameter(parameters, binding.irpFunctionInputLayout, "F", binding.irpFunctionEditText)) {
            return;
        }

        binding.renderIrpButton.setEnabled(false);
        binding.timingsEditText.setText("Rendering IRP...");

        final String normalizedProtocol = protocol.trim();
        infraredRepository.renderSignedRaw(normalizedProtocol, parameters, new InfraredRepository.Callback<InfraredRepository.RenderResult>() {
            @Override
            public void onSuccess(InfraredRepository.RenderResult value) {
                if (!isAdded() || binding == null) {
                    return;
                }
                binding.renderIrpButton.setEnabled(true);
                if (value == null || TextUtils.isEmpty(value.getData())) {
                    showToastOnUiThread("Render returned empty data");
                    return;
                }
                String data = value.getData().trim();
                Log.d("SamplerFragment", "IRP render data length=" + data.length() + " sample=" + truncateForLog(data));
                binding.timingsEditText.setText(data);
                try {
                    float[] timings = parseSignedRawTimings(data);
                    if (timings.length == 0) {
                        showToastOnUiThread("Rendered timings are empty");
                        return;
                    }
                    byte[] binary = Utils.convertTimingsToBinary(timings);
                    Log.d("SamplerFragment", "Converted rendered timings to " + binary.length + " bytes");
                    BLEService.loadBuffer(binary);
                    lastBufferSize = -1;
                    refreshChart();
                    markBufferDirty(false, null);
                    showToastOnUiThread("Signal rendered");
                } catch (NumberFormatException e) {
                    showToastOnUiThread("Invalid timings returned by backend");
                }
            }

            @Override
            public void onError(String message) {
                if (!isAdded() || binding == null) {
                    return;
                }
                binding.renderIrpButton.setEnabled(true);
                showToastOnUiThread(TextUtils.isEmpty(message) ? "Failed to render signal" : message);
            }
        });
    }

    private boolean applyNumericParameter(Map<String, Object> target,
                                          TextInputLayout layout,
                                          String key,
                                          TextInputEditText input) {
        if (layout == null || input == null) {
            return true;
        }
        String raw = getInputText(input);
        layout.setError(null);
        if (TextUtils.isEmpty(raw)) {
            return true;
        }
        try {
            int value = parseNumericValue(raw);
            target.put(key, value);
            return true;
        } catch (NumberFormatException e) {
            layout.setError("Invalid value");
            return false;
        }
    }

    private String getInputText(TextInputEditText editText) {
        if (editText == null || editText.getText() == null) {
            return "";
        }
        return editText.getText().toString().trim();
    }

    private int parseNumericValue(String raw) {
        return Integer.decode(raw);
    }

    private float[] parseSignedRawTimings(String data) {
        if (TextUtils.isEmpty(data)) {
            return new float[0];
        }
        String trimmed = data.trim();
        List<Float> values = new ArrayList<>();

        if (trimmed.contains("[")) {
            Matcher matcher = Pattern.compile("\\[([^\\]]*)\\]").matcher(trimmed);
            while (matcher.find()) {
                String segment = matcher.group(1);
                if (TextUtils.isEmpty(segment)) {
                    continue;
                }
                String[] parts = segment.split(",");
                for (String part : parts) {
                    String cleaned = part.trim();
                    if (cleaned.isEmpty()) {
                        continue;
                    }
                    try {
                        float value = Float.parseFloat(cleaned);
                        if (value != 0f) {
                            values.add(Math.abs(value));
                        }
                    } catch (NumberFormatException ignore) {
                        Log.w("SamplerFragment", "Skipping invalid timing value: " + cleaned);
                    }
                }
            }
        } else {
            String[] parts = trimmed.split("\\s+");
            for (String part : parts) {
                if (TextUtils.isEmpty(part)) {
                    continue;
                }
                try {
                    float value = Float.parseFloat(part);
                    if (value != 0f) {
                        values.add(Math.abs(value));
                    }
                } catch (NumberFormatException ignore) {
                    Log.w("SamplerFragment", "Skipping invalid timing token: " + part);
                }
            }
        }

        float[] timings = new float[values.size()];
        for (int i = 0; i < values.size(); i++) {
            timings[i] = values.get(i);
        }
        return timings;
    }

    private String truncateForLog(String value) {
        if (TextUtils.isEmpty(value)) {
            return "";
        }
        int limit = 120;
        return value.length() <= limit ? value : value.substring(0, limit) + "...";
    }

    private void convertToIR() {
        if (BLEService == null) {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        if (BLEService.getBufferLength() == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }
        byte[] buffer = BLEService.getBuffer();
        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Cannot access buffer", Toast.LENGTH_SHORT).show();
            return;
        }
        byte[] irBuffer = com.emwaver.emwaverandroidapp.Utils.convertToIRBuffer(buffer);
        BLEService.loadBuffer(irBuffer);
        refreshChart();
        markBufferDirty(false, null);
        Toast.makeText(getContext(), "Signal converted to precise 38kHz IR carrier", Toast.LENGTH_SHORT).show();
    }

    private void showTimingsDialog(String timingsText) {
        AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
        LayoutInflater inflater = requireActivity().getLayoutInflater();
        View dialogView = inflater.inflate(R.layout.dialog_timings, null);
        builder.setView(dialogView);

        TextView timingsTextView = dialogView.findViewById(R.id.timingsTextView);
        timingsTextView.setText(timingsText);

        builder.setTitle("Timings");
        builder.setPositiveButton("Copy", (dialog, which) -> {
            ClipboardManager clipboard = (ClipboardManager) requireContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Timings", timingsText);
            clipboard.setPrimaryClip(clip);
            Toast.makeText(getContext(), "Timings copied to clipboard", Toast.LENGTH_SHORT).show();
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss());

        AlertDialog dialog = builder.create();
        dialog.show();
    }

    private void forceRefresh() {
        forceRefresh = true;
        refreshChart();
    }

    private static class SignalsAdapter extends RecyclerView.Adapter<SignalsAdapter.SignalViewHolder> {

        interface OnSignalClickListener {
            void onSignalClick(UserFileMetadata metadata);
        }

        private final List<UserFileMetadata> items = new ArrayList<>();
        private final OnSignalClickListener listener;
        private String activeSignalId;
        private boolean activeDirty;

        SignalsAdapter(OnSignalClickListener listener) {
            this.listener = listener;
        }

        void setSignals(List<UserFileMetadata> signals) {
            items.clear();
            if (signals != null) {
                items.addAll(signals);
            }
            notifyDataSetChanged();
        }

        void setActiveSignal(@Nullable String signalId, boolean dirty) {
            if (!TextUtils.equals(activeSignalId, signalId) || activeDirty != dirty) {
                activeSignalId = signalId;
                activeDirty = dirty;
                notifyDataSetChanged();
            }
        }

        @NonNull
        @Override
        public SignalViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            LayoutInflater inflater = LayoutInflater.from(parent.getContext());
            View view = inflater.inflate(R.layout.item_signal, parent, false);
            return new SignalViewHolder(view);
        }

        @Override
        public void onBindViewHolder(@NonNull SignalViewHolder holder, int position) {
            UserFileMetadata metadata = items.get(position);
            boolean isActive = activeSignalId != null && metadata.getId() != null && metadata.getId().equals(activeSignalId);
            boolean dirty = isActive && activeDirty;
            holder.bind(metadata, listener, isActive, dirty);
        }

        @Override
        public int getItemCount() {
            return items.size();
        }

        static class SignalViewHolder extends RecyclerView.ViewHolder {
            private final TextView nameView;
            private final TextView metaView;

            SignalViewHolder(@NonNull View itemView) {
                super(itemView);
                nameView = itemView.findViewById(R.id.signalName);
                metaView = itemView.findViewById(R.id.signalMeta);
            }

            void bind(UserFileMetadata metadata, OnSignalClickListener listener, boolean isActive, boolean isDirty) {
                nameView.setText(metadata.getName());
                nameView.setTypeface(null, isActive ? Typeface.BOLD : Typeface.NORMAL);
                metaView.setText(formatMeta(metadata.getSizeBytes(), isActive, isDirty));
                itemView.setAlpha(isActive ? 1f : 0.9f);
                itemView.setOnClickListener(v -> listener.onSignalClick(metadata));
            }

            private String formatMeta(long bytes, boolean isActive, boolean isDirty) {
                String base;
                if (bytes <= 0) {
                    base = "Size unknown";
                } else if (bytes < 1024) {
                    base = bytes + " bytes";
                } else if (bytes < 1024 * 1024) {
                    base = String.format(Locale.US, "%.1f KB", bytes / 1024.0);
                } else {
                    base = String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
                }
                if (isActive) {
                    if (isDirty) {
                        base += " • Unsaved changes";
                    } else {
                        base += " • Active";
                    }
                }
                return base;
            }
        }
    }

    private byte getPinNumberFromSelection(String selectedPinString) {
        // Extracts the IO number, e.g., from "IR TX (IO4)" or "GPIO0 (IO0)"
        Pattern pattern = Pattern.compile("\\(IO(\\d+)\\)");
        Matcher matcher = pattern.matcher(selectedPinString);
        if (matcher.find()) {
            try {
                // Group 1 contains the number part
                return (byte) Integer.parseInt(matcher.group(1));
            } catch (NumberFormatException e) {
                Log.e("SamplerFragment", "Failed to parse IO number from: " + selectedPinString + " extracted part: " + matcher.group(1), e);
            }
        }
        Log.e("SamplerFragment", "Could not extract IO number from: " + selectedPinString + ". Check PINS array format and regex.");
        Toast.makeText(getContext(), "Error: Could not parse pin number from '" + selectedPinString + "'", Toast.LENGTH_LONG).show();
        return -1; // Indicates an error
    }
}