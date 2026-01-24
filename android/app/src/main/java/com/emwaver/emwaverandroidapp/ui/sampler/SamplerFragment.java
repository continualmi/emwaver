/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.emwaver.emwaverandroidapp.ui.sampler;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.preference.PreferenceManager;
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
import android.widget.Spinner;
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

import com.emwaver.emwaverandroidapp.NativeBuffer;
import com.emwaver.emwaverandroidapp.USBService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.databinding.FragmentSamplerBinding;
import com.github.mikephil.charting.charts.LineChart;
import com.github.mikephil.charting.components.XAxis;
import com.github.mikephil.charting.components.YAxis;
import com.github.mikephil.charting.data.Entry;
import com.github.mikephil.charting.data.LineData;
import com.github.mikephil.charting.data.LineDataSet;
import com.github.mikephil.charting.listener.ChartTouchListener;
import com.github.mikephil.charting.listener.OnChartGestureListener;

import java.util.ArrayList;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SamplerFragment extends Fragment {

    private SamplerViewModel rawModeViewModel;
    private FragmentSamplerBinding binding;
    private static com.emwaver.emwaverandroidapp.USBService USBService;
    LineChart chart = null;
    private int chartMinX = 0;
    private int chartMaxX = 10000;
    private boolean isUsbServiceBound = false;
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

    // Device type
    private static final int DEVICE_STM32 = 1;

    // STM32 pins (USB sampler)
    // Encoded pin format matches STM32 firmware gpio aliases:
    // - A0..A15 (PA0..PA15) => 0..15
    // - B0..B15 (PB0..PB15) => 16..31
    private static final String[] STM32_PINS = {
            "A0 (IR_RX)",
            "A1 (IR_TX)",
            "A2 (GDO0)",
            "A3 (GDO2)",
            "A4 (NSS)",
            "A5 (SCK)",
            "A6 (MISO)",
            "A7 (MOSI)",
            "A13 (SWCLK)",
            "A14 (SWDIO)",
            "B6 (UART TX / I2C SCL)",
            "B7 (UART RX / I2C SDA)"
    };

    private static final String PREF_SELECTED_PIN_INDEX_STM32 = "selectedSamplerPinIndexStm32";
    private static final String PREF_SELECTED_PIN_ENCODED_STM32 = "selectedSamplerPinEncodedStm32";
    private static final String PREF_LAST_SELECTED_SIGNAL = "sampler_last_selected_signal";
    private static final String PREF_TX_PWM_ENABLED = "sampler_tx_pwm_enabled";
    private static final String PREF_TX_PWM_FREQ_HZ = "sampler_tx_pwm_freq_hz";
    private static final String PREF_TX_PWM_DUTY_PERCENT = "sampler_tx_pwm_duty_percent";
    private static final String PREF_INVERT_RECORDING = "sampler_invert_recording";
    private static final String PREF_INVERT_RECORDING_TARGETS = "sampler_invert_recording_targets";
    private static final int DEFAULT_TX_PWM_FREQ_HZ = 38000;
    private static final int DEFAULT_TX_PWM_DUTY_PERCENT = 100;
    private static final String SIGNALS_DIR = "signals";

    private File signalsDir;
    private final List<String> savedSignalNames = new ArrayList<>();
    private ArrayAdapter<String> signalPickerAdapter;
    private ArrayAdapter<String> gpioAdapter;
    private int currentDeviceType = DEVICE_STM32;
    private ActivityResultLauncher<String[]> openRawFileLauncher;
    private String currentSignalName;
    private boolean hasUnsavedChanges;
    private AdapterView.OnItemSelectedListener signalPickerListener;

    private final ServiceConnection usbServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            USBService.LocalBinder binder = (USBService.LocalBinder) service;
            USBService = binder.getService();
            isUsbServiceBound = true;
            Log.i("usb service binding", "onServiceConnected");
            updateDeviceTypeFromConnection();
            initChart();
            refreshChart();
            if (TextUtils.isEmpty(currentSignalName) && !savedSignalNames.isEmpty()) {
                loadLastSelectedSignal();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isUsbServiceBound = false;
            Log.i("usb service binding", "onServiceDisconnected");
        }
    };

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Initialize signals directory
        File appFilesDir = requireContext().getFilesDir();
        signalsDir = new File(appFilesDir, SIGNALS_DIR);
        if (!signalsDir.exists()) {
            signalsDir.mkdirs();
        }
        
        // Setup file picker launcher for importing signals
        openRawFileLauncher = registerForActivityResult(
            new ActivityResultContracts.OpenDocument(),
            uri -> {
                if (uri != null) {
                    importSignalFromExternalStorage(uri);
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

        chart = binding.chart;

        SharedPreferences pwmPrefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        int pwmFreqHz = pwmPrefs.getInt(PREF_TX_PWM_FREQ_HZ, DEFAULT_TX_PWM_FREQ_HZ);
        int pwmDutyPercent = pwmPrefs.getInt(PREF_TX_PWM_DUTY_PERCENT, DEFAULT_TX_PWM_DUTY_PERCENT);
        boolean pwmEnabled = pwmPrefs.getBoolean(PREF_TX_PWM_ENABLED, true);
        binding.pwmSwitch.setChecked(pwmEnabled);
        binding.pwmFreqEdit.setText(String.valueOf(pwmFreqHz));

        // Duty is restricted to {100, 50}. Default is 100 (effectively non-carrier).
        final List<Integer> dutyOptions = java.util.Arrays.asList(100, 50);
        ArrayAdapter<String> dutyAdapter = new ArrayAdapter<>(
                requireContext(),
                android.R.layout.simple_spinner_item,
                java.util.Arrays.asList("100%", "50%")
        );
        dutyAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.pwmDutySpinner.setAdapter(dutyAdapter);
        int dutySelectionIndex = (pwmDutyPercent == 50) ? 1 : 0;
        binding.pwmDutySpinner.setSelection(dutySelectionIndex, false);
        binding.pwmDutySpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                int selectedDuty = (position >= 0 && position < dutyOptions.size()) ? dutyOptions.get(position) : 100;
                pwmPrefs.edit().putInt(PREF_TX_PWM_DUTY_PERCENT, selectedDuty).apply();
                updatePwmUiState();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                // no-op
            }
        });

        binding.pwmSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            pwmPrefs.edit().putBoolean(PREF_TX_PWM_ENABLED, isChecked).apply();
            updatePwmUiState();
        });

        // Setup signal picker
        List<String> pickerItems = new ArrayList<>();
        pickerItems.add("New signal...");
        pickerItems.addAll(savedSignalNames);
        signalPickerAdapter = new ArrayAdapter<>(requireContext(), 
            android.R.layout.simple_spinner_item, pickerItems);
        signalPickerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.signalPicker.setAdapter(signalPickerAdapter);
        signalPickerListener = new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (position > 0) { // Position 0 is "New signal..."
                    String selectedSignal = savedSignalNames.get(position - 1);
                    loadSignalFromStorage(selectedSignal);
                } else {
                    // Position 0 - "New signal..."
                    createNewSignal();
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        };
        binding.signalPicker.setOnItemSelectedListener(signalPickerListener);

        updateDeviceTypeFromConnection();
        updatePwmUiState();

        binding.gpioSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                // Show retransmit button for all pins
                binding.retransmitButton.setVisibility(View.VISIBLE);

                SharedPreferences sp = PreferenceManager.getDefaultSharedPreferences(requireContext());
                SharedPreferences.Editor editor = sp.edit();
                editor.putInt(PREF_SELECTED_PIN_INDEX_STM32, position);
                String selection = (String) parent.getItemAtPosition(position);
                int encodedPin = getStm32EncodedPinFromSelection(selection);
                if (encodedPin >= 0) {
                    editor.putInt(PREF_SELECTED_PIN_ENCODED_STM32, encodedPin);
                }
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
        
        // Initially disable the stop button as we're not recording yet
        binding.stopButton.setEnabled(false);
        
        // Initialize current signal name and unsaved changes
        currentSignalName = null;
        hasUnsavedChanges = false;
        updateStatusBar();
        
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
                    updateMetricsLabel(getCurrentBufferLengthBytes(),
                            rawModeViewModel.getVisibleRangeStart(),
                            rawModeViewModel.getVisibleRangeEnd());
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
                rawModeViewModel.setVisibleRangeEnd(visibleRangeEnd);

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
                    updateMetricsLabel(getCurrentBufferLengthBytes(), visibleRangeStart, visibleRangeEnd);
                    updateChartWithCompression(visibleRangeStart, visibleRangeEnd, visiblePoints);
                }
            }
        });

        initScheduler();

        setupMenu();
        refreshSignalList(() -> {
            // After refreshing the list, try to load the last selected signal
            loadLastSelectedSignal();
        });
        updateStatusBar();

        return root;
    }

    private int getActiveDeviceType() {
        return DEVICE_STM32;
    }

    private void updateDeviceTypeFromConnection() {
        if (!isAdded() || binding == null) {
            return;
        }

        currentDeviceType = DEVICE_STM32;
        boolean connected = USBService != null && USBService.checkConnection();
        binding.deviceLabel.setText(connected ? "Device: STM32 (USB)" : "Device: —");
        updateGpioSpinnerForCurrentDevice();
        updatePwmUiState();
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
                } else if (id == R.id.action_save_signal) {
                    saveSignalToStorage();
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
                }
                return false;
            }
        };

        requireActivity().addMenuProvider(menuProvider, getViewLifecycleOwner(), Lifecycle.State.RESUMED);
    }

    private void clearBuffer() {
        if (USBService != null) {
            USBService.clearBuffer();
            lastBufferSize = -1; // Force refresh
            refreshChart();
            markBufferDirty();
            return;
        }
        Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
    }

    private void selectSignalFromExternalStorage() {
        if (openRawFileLauncher == null) {
            return;
        }
        openRawFileLauncher.launch(new String[]{"application/octet-stream", "*/*"});
    }

    private void importSignalFromExternalStorage(Uri uri) {
        if (!isAdded()) {
            return;
        }
        new Thread(() -> {
            try {
                byte[] data = readBytesFromUri(uri);
                if (data == null || data.length == 0) {
                    requireActivity().runOnUiThread(() -> {
                        Toast.makeText(requireContext(), "Selected file is empty", Toast.LENGTH_SHORT).show();
                    });
                    return;
                }
                String displayName = getDisplayNameFromUri(uri);
                String normalizedName = normalizeSignalName(displayName);
                
                // Save to internal storage
                File signalFile = new File(signalsDir, normalizedName);
                try (FileOutputStream fos = new FileOutputStream(signalFile)) {
                    fos.write(data);
                    fos.flush();
                }
                
                // Load into buffer and refresh chart
                requireActivity().runOnUiThread(() -> {
                    if (!isAdded()) {
                        return;
                    }
                    if (USBService == null) {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        refreshSignalList();
                        return;
                    }

                    USBService.loadBuffer(data);

                    lastBufferSize = -1;
                    resetChartZoom();
                    refreshChart();
                    currentSignalName = normalizedName;
                    hasUnsavedChanges = false;
                    saveLastSelectedSignal(normalizedName);
                    updateStatusBar();
                    Toast.makeText(requireContext(), "Signal imported: " + normalizedName, Toast.LENGTH_SHORT).show();
                    // Refresh list and update picker selection
                    refreshSignalList(() -> {
                        int signalIndex = savedSignalNames.indexOf(normalizedName);
                        if (signalIndex >= 0) {
                            binding.signalPicker.setSelection(signalIndex + 1); // +1 because position 0 is "New signal..."
                        }
                    });
                });
            } catch (IOException e) {
                Log.e("SamplerFragment", "Failed to import signal", e);
                requireActivity().runOnUiThread(() -> {
                    Toast.makeText(requireContext(), "Failed to import signal", Toast.LENGTH_SHORT).show();
                });
            }
        }).start();
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
        if (TextUtils.isEmpty(result)) {
            result = generateNewSignalName();
        }
        return result;
    }

    private void saveSignalToStorage() {
        if (USBService == null) {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        final byte[] buffer = USBService.getBuffer();

        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Save Signal");
        builder.setMessage("Enter a name for the signal:");
        final EditText input = new EditText(requireContext());
        String defaultName = generateNewSignalName();
        input.setText(defaultName);
        input.setSelection(defaultName.length());
        builder.setView(input);
        builder.setPositiveButton("Save", (dialog, which) -> {
            String entered = input.getText() != null ? input.getText().toString().trim() : "";
            if (TextUtils.isEmpty(entered)) {
                entered = defaultName;
            }
            String normalized = normalizeSignalName(entered);
            saveSignalFile(normalized, buffer.clone());
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void saveSignalFile(String fileName, byte[] data) {
        new Thread(() -> {
            try {
                File signalFile = new File(signalsDir, fileName);
                try (FileOutputStream fos = new FileOutputStream(signalFile)) {
                    fos.write(data);
                    fos.flush();
                }
                requireActivity().runOnUiThread(() -> {
                    currentSignalName = fileName;
                    hasUnsavedChanges = false;
                    saveLastSelectedSignal(fileName);
                    updateStatusBar();
                    refreshSignalList(() -> {
                        // Update picker selection to show the saved signal
                        int signalIndex = savedSignalNames.indexOf(fileName);
                        if (signalIndex >= 0) {
                            binding.signalPicker.setSelection(signalIndex + 1); // +1 because position 0 is "New signal..."
                        }
                    });
                    Toast.makeText(requireContext(), "Signal saved: " + fileName, Toast.LENGTH_SHORT).show();
                });
            } catch (IOException e) {
                Log.e("SamplerFragment", "Failed to save signal", e);
                requireActivity().runOnUiThread(() -> {
                    Toast.makeText(requireContext(), "Failed to save signal", Toast.LENGTH_SHORT).show();
                });
            }
        }).start();
    }

    private void loadSignalFromStorage(String fileName) {
        // Prevent loading the same signal if it's already loaded
        if (fileName.equals(currentSignalName) && !hasUnsavedChanges) {
            return;
        }
        
        new Thread(() -> {
            try {
                File signalFile = new File(signalsDir, fileName);
                if (!signalFile.exists()) {
                    requireActivity().runOnUiThread(() -> {
                        Toast.makeText(requireContext(), "Signal file not found", Toast.LENGTH_SHORT).show();
                    });
                    return;
                }
                byte[] data = readSignalFile(signalFile);
                if (data == null || data.length == 0) {
                    requireActivity().runOnUiThread(() -> {
                        Toast.makeText(requireContext(), "Signal file is empty", Toast.LENGTH_SHORT).show();
                    });
                    return;
                }
                requireActivity().runOnUiThread(() -> {
                    if (USBService == null) {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        return;
                    }

                    USBService.loadBuffer(data);
                    
                    lastBufferSize = -1;
                    resetChartZoom();
                    refreshChart();
                    currentSignalName = fileName;
                    hasUnsavedChanges = false;
                    saveLastSelectedSignal(fileName);
                    updateStatusBar();
                    // Update picker selection (only if binding is available and listener is set)
                    if (binding != null && signalPickerListener != null) {
                        int signalIndex = savedSignalNames.indexOf(fileName);
                        if (signalIndex >= 0) {
                            // Temporarily disable listener to prevent recursive calls
                            binding.signalPicker.setOnItemSelectedListener(null);
                            binding.signalPicker.setSelection(signalIndex + 1); // +1 because position 0 is "New signal..."
                            // Re-enable listener after a short delay to ensure selection is set
                            binding.signalPicker.post(() -> {
                                if (binding != null && signalPickerListener != null) {
                                    binding.signalPicker.setOnItemSelectedListener(signalPickerListener);
                                }
                            });
                        }
                    }
                    Toast.makeText(requireContext(), "Signal loaded", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception e) {
                Log.e("SamplerFragment", "Failed to load signal", e);
                requireActivity().runOnUiThread(() -> {
                    Toast.makeText(requireContext(), "Failed to load signal", Toast.LENGTH_SHORT).show();
                });
            }
        }).start();
    }

    private byte[] readSignalFile(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] buffer = new byte[(int) file.length()];
            fis.read(buffer);
            return buffer;
        }
    }

    private void refreshSignalList() {
        refreshSignalList(null);
    }

    private void refreshSignalList(@Nullable Runnable onComplete) {
        if (!isAdded() || binding == null) {
            return;
        }
        new Thread(() -> {
            List<String> signalNames = new ArrayList<>();
            File[] files = signalsDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isFile() && file.getName().toLowerCase(Locale.US).endsWith(".raw")) {
                        signalNames.add(file.getName());
                    }
                }
            }
            Collections.sort(signalNames);
            requireActivity().runOnUiThread(() -> {
                if (!isAdded() || binding == null) {
                    return;
                }
                savedSignalNames.clear();
                savedSignalNames.addAll(signalNames);
                List<String> pickerItems = new ArrayList<>();
                pickerItems.add("New signal...");
                pickerItems.addAll(savedSignalNames);
                signalPickerAdapter.clear();
                signalPickerAdapter.addAll(pickerItems);
                signalPickerAdapter.notifyDataSetChanged();
                if (onComplete != null) {
                    onComplete.run();
                }
            });
        }).start();
    }

    private String generateNewSignalName() {
        String base = "signal";
        int counter = 1;
        String candidate = base + counter + ".raw";
        while (savedSignalNames.contains(candidate)) {
            counter++;
            candidate = base + counter + ".raw";
        }
        return candidate;
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

    private int getCurrentBufferLengthBytes() {
        return USBService != null ? USBService.getBufferLength() : 0;
    }

    private void refreshChart() {
        if (USBService == null) {
            return;
        }

        int currentBufferSize = USBService.getBufferLength();

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

        updateMetricsLabel(currentBufferSize, visibleRangeStart, visibleRangeEnd);
        updateChartWithCompression(visibleRangeStart, visibleRangeEnd, visiblePoints);
    }

    private void updateMetricsLabel(int bufferLenBytes, int visibleRangeStart, int visibleRangeEnd) {
        if (!isAdded() || binding == null) {
            return;
        }

        int maxX = Math.max(0, bufferLenBytes * 8);
        int clampedStart = Math.max(0, Math.min(visibleRangeStart, maxX));
        int clampedEnd = Math.max(0, Math.min(visibleRangeEnd, maxX));
        if (clampedEnd < clampedStart) {
            int tmp = clampedEnd;
            clampedEnd = clampedStart;
            clampedStart = tmp;
        }

        int viewSpan = Math.max(0, clampedEnd - clampedStart);
        double bitsPerBin = visiblePoints > 0 ? (double) viewSpan / (double) visiblePoints : 0.0;

        String text = String.format(
                Locale.US,
                "bytes=%d  samples=%d  view=%d..%d  bins=%d  bits/bin=%.1f",
                bufferLenBytes,
                bufferLenBytes * 8,
                clampedStart,
                clampedEnd,
                visiblePoints,
                bitsPerBin
        );

        binding.metricsRowText.setText(text);
    }

    private void startRecording() {
        updateDeviceTypeFromConnection();
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        boolean invertDuringRecording = prefs.getBoolean(PREF_INVERT_RECORDING, false);
        String invertTargets = prefs.getString(PREF_INVERT_RECORDING_TARGETS, "stm32");
        boolean shouldInvert = invertDuringRecording && invertShouldApplyToDevice(getActiveDeviceType(), invertTargets);
        if (currentDeviceType == DEVICE_STM32) {
            if (USBService == null) {
                Toast.makeText(getContext(), "USB Service not available", Toast.LENGTH_SHORT).show();
                return;
            }

            USBService.clearBuffer();

            String selected = binding.gpioSpinner.getSelectedItem().toString();
            int encodedPin = getStm32EncodedPinFromSelection(selected);
            if (encodedPin < 0) {
                Toast.makeText(getContext(), "Invalid STM32 pin selected", Toast.LENGTH_SHORT).show();
                return;
            }

            String commandStr = "sample start --pin=" + encodedPin;
            byte[] command = commandStr.getBytes();
            NativeBuffer.setInvertRx(shouldInvert);
            USBService.write(command);
            
        }
        
        // Set recording flag
        isRecording = true;
        
        // Disable record button while recording
        binding.recordButton.setEnabled(false);
        // Enable stop button
        binding.stopButton.setEnabled(true);
        
        Toast.makeText(getContext(), "Recording started", Toast.LENGTH_SHORT).show();
    }

    private static boolean invertShouldApplyToDevice(int deviceType, @Nullable String targets) {
        return deviceType == DEVICE_STM32;
    }

    private void stopRecording() {
        updateDeviceTypeFromConnection();
        if (USBService != null) {
            byte[] command = "sample stop".getBytes();
            USBService.write(command);
        }

        NativeBuffer.setInvertRx(false);
            
        // Clear recording flag
        isRecording = false;
        
        // Re-enable record button
        binding.recordButton.setEnabled(true);
        // Disable stop button
        binding.stopButton.setEnabled(false);
        
        Toast.makeText(getContext(), "Recording stopped", Toast.LENGTH_SHORT).show();
        markBufferDirty();
    }

    private void retransmitSignal() {
        updateDeviceTypeFromConnection();
        if (currentDeviceType == DEVICE_STM32) {
            if (USBService == null) {
                Toast.makeText(getContext(), "USB Service not available", Toast.LENGTH_SHORT).show();
                return;
            }

            int bufferLength = USBService.getBufferLength();
            if (bufferLength <= 0) {
                Toast.makeText(getContext(), "No samples to retransmit", Toast.LENGTH_SHORT).show();
                return;
            }

            String selected = binding.gpioSpinner.getSelectedItem().toString();
            int encodedPin = getStm32EncodedPinFromSelection(selected);
            if (encodedPin < 0) {
                Toast.makeText(getContext(), "Invalid STM32 pin selected", Toast.LENGTH_SHORT).show();
                return;
            }
            if (encodedPin < 0 || encodedPin > 3) {
                Toast.makeText(getContext(), "STM32 retransmit supports A0–A3 only", Toast.LENGTH_SHORT).show();
                return;
            }
            
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
            int freqHz = parsePwmIntOrDefault(binding.pwmFreqEdit.getText().toString(), DEFAULT_TX_PWM_FREQ_HZ);
            int dutyPercent = getSelectedDutyPercent();
            if (freqHz < 1) {
                Toast.makeText(getContext(), "Invalid PWM frequency", Toast.LENGTH_SHORT).show();
                return;
            }
            if (dutyPercent < 1 || dutyPercent > 100) {
                Toast.makeText(getContext(), "Invalid PWM duty (1-100)", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit()
                    .putBoolean(PREF_TX_PWM_ENABLED, true)
                    .putInt(PREF_TX_PWM_FREQ_HZ, freqHz)
                    .putInt(PREF_TX_PWM_DUTY_PERCENT, dutyPercent)
                    .apply();

            String commandStr = "transmit start --pin=" + encodedPin + " --freq=" + freqHz + " --duty=" + dutyPercent;
            byte[] commandBytes = commandStr.getBytes();
            new Thread(() -> {
                USBService.write(commandBytes);
                USBService.transmitBuffer();
            }).start();
            
            Toast.makeText(getContext(), "Retransmitting " + bufferLength + " samples", Toast.LENGTH_SHORT).show();

        }
    }

    private int parsePwmIntOrDefault(String raw, int defaultValue) {
        if (raw == null) {
            return defaultValue;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(trimmed);
        } catch (NumberFormatException e) {
            return defaultValue;
        }
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
        Object[] result = null;
        if (USBService != null) {
            result = (Object[]) USBService.compressDataBits(rangeStart, rangeEnd, numberBins);
        }
        
        if (result == null) return new LineDataSet(new ArrayList<>(), "No Data");

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
        if (!isUsbServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), USBService.class);
            getActivity().bindService(intent, usbServiceConnection, Context.BIND_AUTO_CREATE);
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

        updateDeviceTypeFromConnection();
        
        // Initialize scheduler with the latest settings
        initScheduler();
        
        // Force a refresh to make sure we're showing current data
        forceRefresh();

        refreshSignalList(() -> {
            // After refreshing the list, try to load the last selected signal if not already loaded
            if (TextUtils.isEmpty(currentSignalName)) {
                loadLastSelectedSignal();
            }
        });
        updateStatusBar();
        
        // Update UI based on recording state
        binding.recordButton.setEnabled(!isRecording);
        binding.stopButton.setEnabled(isRecording);
    }
    @Override
    public void onPause() {
        super.onPause();
        stopScheduler();
        Utils.updateActionBarStatus(this, "");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopScheduler();
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
        final byte[] bufferData;
        if (USBService != null) {
            bufferData = USBService.getBuffer();
        } else {
            Toast.makeText(getContext(), "USB Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        if (bufferData == null || bufferData.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }

        String timings = buildSignedRawTimings(bufferData);
        if (TextUtils.isEmpty(timings)) {
            Toast.makeText(getContext(), "Unable to compute timings", Toast.LENGTH_SHORT).show();
            return;
        }

        showTimingsDialog(timings);
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

    private void updateGpioSpinnerForCurrentDevice() {
        if (!isAdded() || binding == null) {
            return;
        }

        String[] pins = STM32_PINS;

        if (gpioAdapter == null) {
            gpioAdapter = new ArrayAdapter<>(requireContext(),
                    android.R.layout.simple_spinner_item, new ArrayList<>(java.util.Arrays.asList(pins)));
            gpioAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            binding.gpioSpinner.setAdapter(gpioAdapter);
        } else {
            gpioAdapter.clear();
            gpioAdapter.addAll(pins);
            gpioAdapter.notifyDataSetChanged();
        }

        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        int selectedPinIndex;

        Integer encodedPin = null;
        if (prefs.contains(PREF_SELECTED_PIN_ENCODED_STM32)) {
            int encoded = prefs.getInt(PREF_SELECTED_PIN_ENCODED_STM32, -1);
            if (encoded >= 0) {
                encodedPin = encoded;
            }
        }

        if (encodedPin == null && prefs.contains(PREF_SELECTED_PIN_INDEX_STM32)) {
            int legacyIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX_STM32, -1);
            if (legacyIndex >= 0 && legacyIndex < LEGACY_STM32_PINS.length) {
                int migrated = getStm32EncodedPinFromSelection(LEGACY_STM32_PINS[legacyIndex]);
                if (migrated >= 0) {
                    prefs.edit().putInt(PREF_SELECTED_PIN_ENCODED_STM32, migrated).apply();
                    encodedPin = migrated;
                }
            }
        }

        if (encodedPin != null) {
            selectedPinIndex = findStm32IndexForEncodedPin(encodedPin);
        } else {
            selectedPinIndex = 0;
        }

        if (selectedPinIndex >= 0 && selectedPinIndex < gpioAdapter.getCount()) {
            binding.gpioSpinner.setSelection(selectedPinIndex);
        } else if (gpioAdapter.getCount() > 0) {
            binding.gpioSpinner.setSelection(0);
        }
    }

    private int findStm32IndexForEncodedPin(int encodedPin) {
        for (int i = 0; i < STM32_PINS.length; i++) {
            if (getStm32EncodedPinFromSelection(STM32_PINS[i]) == encodedPin) {
                return i;
            }
        }
        return 0;
    }

    private int getStm32EncodedPinFromSelection(String selectedPinString) {
        if (selectedPinString == null) {
            return -1;
        }
        Pattern pattern = Pattern.compile("\\bP?([AB])(\\d{1,2})\\b");
        Matcher matcher = pattern.matcher(selectedPinString);
        if (!matcher.find()) {
            return -1;
        }
        String port = matcher.group(1);
        int pin;
        try {
            pin = Integer.parseInt(matcher.group(2));
        } catch (NumberFormatException e) {
            return -1;
        }
        if (pin < 0 || pin > 15) {
            return -1;
        }
        if ("A".equals(port)) {
            return pin;
        }
        if ("B".equals(port)) {
            return 16 + pin;
        }
        return -1;
    }

    private void updatePwmUiState() {
        if (!isAdded() || binding == null) {
            return;
        }

        binding.pwmSwitch.setChecked(true);
        binding.pwmSwitch.setEnabled(false);
        binding.pwmSwitch.setAlpha(0.6f);

        boolean pwmEnabled = binding.pwmSwitch.isChecked();
        binding.pwmOptionsGroup.setVisibility(pwmEnabled ? View.VISIBLE : View.GONE);
        binding.pwmLabel.setAlpha(pwmEnabled ? 1.0f : 0.5f);
        if (!pwmEnabled) {
            return;
        }

        int dutyPercent = getSelectedDutyPercent();
        boolean freqEnabled = dutyPercent != 100;
        binding.pwmFreqEdit.setEnabled(freqEnabled);
        binding.pwmFreqEdit.setAlpha(freqEnabled ? 1.0f : 0.5f);
        binding.pwmFreqLabel.setAlpha(freqEnabled ? 1.0f : 0.5f);
        binding.pwmDutySpinner.setEnabled(true);
    }

    private int getSelectedDutyPercent() {
        if (binding == null) {
            return DEFAULT_TX_PWM_DUTY_PERCENT;
        }
        int position = binding.pwmDutySpinner.getSelectedItemPosition();
        if (position == 1) {
            return 50;
        }
        return 100;
    }

    private void resetChartZoom() {
        if (chart == null) {
            return;
        }
        // Reset zoom to show full signal
        chart.fitScreen();
        // Also reset the scale to 1.0
        chart.setScaleX(1.0f);
        chart.setScaleY(1.0f);
        // Reset translation
        chart.setTranslationX(0f);
        chart.setTranslationY(0f);
    }

    private static final String[] LEGACY_STM32_PINS = {
            "IR RX (PA1)",
            "PA0 (TIM2 CH1)",
            "PA2 (TIM2 CH3)",
            "PA3 (TIM2 CH4)"
    };


    private void updateStatusBar() {
        if (TextUtils.isEmpty(currentSignalName)) {
            Utils.updateActionBarStatus(this, "No signal");
        } else {
            String displayName = currentSignalName;
            if (hasUnsavedChanges) {
                displayName = displayName + "*";
            }
            Utils.updateActionBarStatus(this, displayName);
        }
    }

    private void markBufferDirty() {
        hasUnsavedChanges = true;
        updateStatusBar();
    }

    private void createNewSignal() {
        if (USBService != null) {
            USBService.clearBuffer();
        } else {
            Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        lastBufferSize = -1;
        refreshChart();
        currentSignalName = null;
        hasUnsavedChanges = false;
        saveLastSelectedSignal(null);
        updateStatusBar();
        Toast.makeText(requireContext(), "New signal ready", Toast.LENGTH_SHORT).show();
    }

    private void saveSignal() {
        if (USBService == null) {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

        byte[] buffer = USBService.getBuffer();

        if (buffer == null || buffer.length == 0) {
            Toast.makeText(getContext(), "Buffer is empty", Toast.LENGTH_SHORT).show();
            return;
        }

        String fileName = generateNewSignalFileName();
        saveSignalFile(fileName, buffer.clone());
    }

    private String generateNewSignalFileName() {
        String baseName = "NewSignal.raw";
        if (!savedSignalNames.contains(baseName)) {
            return baseName;
        }
        
        int counter = 1;
        String candidate = "NewSignal(" + counter + ").raw";
        while (savedSignalNames.contains(candidate)) {
            counter++;
            candidate = "NewSignal(" + counter + ").raw";
        }
        return candidate;
    }

    private void renameSignal() {
        if (TextUtils.isEmpty(currentSignalName)) {
            Toast.makeText(requireContext(), "No signal loaded", Toast.LENGTH_SHORT).show();
            return;
        }
        renameSignalByName(currentSignalName);
    }

    private void renameSignalByName(@NonNull String existingName) {
        File existingFile = new File(signalsDir, existingName);
        if (!existingFile.exists()) {
            Toast.makeText(requireContext(), "Signal file not found", Toast.LENGTH_SHORT).show();
            refreshSignalList();
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(requireContext());
        builder.setTitle("Rename Signal");
        builder.setMessage("Enter a new name:");
        final EditText input = new EditText(requireContext());
        String existingNameWithoutExt = existingName.replace(".raw", "");
        input.setText(existingNameWithoutExt);
        input.setSelection(existingNameWithoutExt.length());
        builder.setView(input);
        builder.setPositiveButton("Rename", (dialog, which) -> {
            String entered = input.getText() != null ? input.getText().toString().trim() : "";
            if (TextUtils.isEmpty(entered)) {
                Toast.makeText(requireContext(), "Name cannot be empty", Toast.LENGTH_SHORT).show();
                return;
            }
            String normalized = normalizeSignalName(entered);
            if (normalized.equals(existingName)) {
                Toast.makeText(requireContext(), "Name unchanged", Toast.LENGTH_SHORT).show();
                return;
            }

            File newFile = new File(signalsDir, normalized);
            if (newFile.exists()) {
                Toast.makeText(requireContext(), "A signal with this name already exists", Toast.LENGTH_SHORT).show();
                return;
            }

            boolean renamed = existingFile.renameTo(newFile);
            if (!renamed) {
                Toast.makeText(requireContext(), "Failed to rename signal", Toast.LENGTH_SHORT).show();
                return;
            }

            if (existingName.equals(currentSignalName)) {
                currentSignalName = normalized;
                hasUnsavedChanges = false;
                saveLastSelectedSignal(normalized);
                updateStatusBar();
            }

            refreshSignalList(() -> {
                int signalIndex = savedSignalNames.indexOf(currentSignalName);
                if (signalIndex >= 0 && binding != null) {
                    binding.signalPicker.setSelection(signalIndex + 1);
                }
            });
            Toast.makeText(requireContext(), "Signal renamed", Toast.LENGTH_SHORT).show();
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private void saveLastSelectedSignal(@Nullable String signalName) {
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        if (TextUtils.isEmpty(signalName)) {
            prefs.edit().remove(PREF_LAST_SELECTED_SIGNAL).apply();
        } else {
            prefs.edit().putString(PREF_LAST_SELECTED_SIGNAL, signalName).apply();
        }
    }

    private void loadLastSelectedSignal() {
        if (binding == null) {
            return;
        }
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        String lastSignalName = prefs.getString(PREF_LAST_SELECTED_SIGNAL, null);
        if (!TextUtils.isEmpty(lastSignalName) && savedSignalNames.contains(lastSignalName)) {
            // Signal exists, load it directly (the check in loadSignalFromStorage prevents duplicates)
            // We'll update the picker selection inside loadSignalFromStorage
            loadSignalFromStorage(lastSignalName);
        }
    }

    private void deleteSignal() {
        if (TextUtils.isEmpty(currentSignalName)) {
            Toast.makeText(requireContext(), "No signal loaded", Toast.LENGTH_SHORT).show();
            return;
        }
        deleteSignalByName(currentSignalName);
    }

    private void deleteSignalByName(@NonNull String signalName) {
        File signalFile = new File(signalsDir, signalName);
        if (!signalFile.exists()) {
            Toast.makeText(requireContext(), "Signal file not found", Toast.LENGTH_SHORT).show();
            refreshSignalList();
            return;
        }

        boolean deletingCurrent = signalName.equals(currentSignalName);
        int currentIndex = savedSignalNames.indexOf(signalName);

        new AlertDialog.Builder(requireContext())
            .setTitle("Delete Signal")
            .setMessage("Delete " + signalName + "?")
            .setPositiveButton("Delete", (dialog, which) -> {
                if (!signalFile.delete()) {
                    Toast.makeText(requireContext(), "Failed to delete signal", Toast.LENGTH_SHORT).show();
                    return;
                }

                if (!deletingCurrent) {
                    refreshSignalList();
                    Toast.makeText(requireContext(), "Signal deleted", Toast.LENGTH_SHORT).show();
                    return;
                }

                String nextSignalName = null;
                if (currentIndex >= 0 && savedSignalNames.size() > 1) {
                    if (currentIndex < savedSignalNames.size() - 1) {
                        nextSignalName = savedSignalNames.get(currentIndex + 1);
                    } else {
                        nextSignalName = savedSignalNames.get(0);
                    }
                }

                final String finalNextSignalName = nextSignalName;
                refreshSignalList(() -> {
                    if (binding == null) {
                        return;
                    }
                    if (finalNextSignalName != null && savedSignalNames.contains(finalNextSignalName)) {
                        int nextIndex = savedSignalNames.indexOf(finalNextSignalName);
                        binding.signalPicker.setSelection(nextIndex + 1);
                    } else {
                        binding.signalPicker.setSelection(0);
                        saveLastSelectedSignal(null);
                        currentSignalName = null;
                        hasUnsavedChanges = false;
                        updateStatusBar();
                    }
                });

                Toast.makeText(requireContext(), "Signal deleted", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
}
