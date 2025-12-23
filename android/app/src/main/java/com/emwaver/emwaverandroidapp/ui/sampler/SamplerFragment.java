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

import com.emwaver.emwaverandroidapp.BLEService;
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
    private static com.emwaver.emwaverandroidapp.BLEService BLEService;
    private static com.emwaver.emwaverandroidapp.USBService USBService;
    LineChart chart = null;
    private int chartMinX = 0;
    private int chartMaxX = 10000;
    private boolean isServiceBound = false;
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

    // Device types
    private static final int DEVICE_ESP32 = 0;
    private static final int DEVICE_STM32 = 1;

    // ESP32 pins (BLE sampler)
    private static final String[] ESP32_PINS = {
            "IO1 DIO0[S]/GDO0[F]",
            "IO2 DIO1[S]/GDO2[F]",
            "IO3 GPIO3",
            "IO4 IR TX[F/D]",
            "IO5 IR RX[F/D]",
            "IO6 GPIO6",
            "IO7 GPIO7",
            "IO8 GPIO8",
            "IO9 GPIO9",
            "IO10 GPIO10",
            "IO11 GPIO11",
            "IO12 GPIO12",
            "IO13 GPIO13",
            "IO14 GPIO14",
            "IO15 GPIO15",
            "IO16 GPIO16",
            "IO17 GPIO17",
            "IO18 GPIO18",
            "IO37 IR TX[S]",
            "IO38 IR RX[S]",
            "IO39 DIO5[S]",
            "IO40 DIO4[S]",
            "IO41 DIO3[S]",
            "IO42 DIO2[S]",
            "IO46 GPIO46"
    };

    // STM32 pins (USB sampler)
    // Note: PA1 is IR_RX, PA0/PA2/PA3 are TIM2 CH1/CH3/CH4 outputs
    private static final String[] STM32_PINS = {
            "IR RX (PA1)",
            "PA0 (TIM2 CH1)",
            "PA2 (TIM2 CH3)",
            "PA3 (TIM2 CH4)"
    };

    // Legacy single-device preference key kept for backwards compatibility
    private static final String PREF_SELECTED_PIN_INDEX = "selectedSamplerPinIndex";
    private static final String PREF_SELECTED_PIN_INDEX_ESP32 = "selectedSamplerPinIndexEsp32";
    private static final String PREF_SELECTED_PIN_INDEX_STM32 = "selectedSamplerPinIndexStm32";
    private static final String PREF_SELECTED_PIN_IO_ESP32 = "selectedSamplerPinIoEsp32";
    private static final String PREF_LAST_SELECTED_SIGNAL = "sampler_last_selected_signal";
    private static final String PREF_TX_PWM_ENABLED = "sampler_tx_pwm_enabled";
    private static final String PREF_TX_PWM_FREQ_HZ = "sampler_tx_pwm_freq_hz";
    private static final String PREF_TX_PWM_DUTY_PERCENT = "sampler_tx_pwm_duty_percent";
    private static final int DEFAULT_TX_PWM_FREQ_HZ = 38000;
    private static final int DEFAULT_TX_PWM_DUTY_PERCENT = 50;
    private static final String SIGNALS_DIR = "signals";

    private File signalsDir;
    private final List<String> savedSignalNames = new ArrayList<>();
    private ArrayAdapter<String> signalPickerAdapter;
    private ArrayAdapter<String> gpioAdapter;
    private int currentDeviceType = DEVICE_ESP32;
    private ActivityResultLauncher<String[]> openRawFileLauncher;
    private String currentSignalName;
    private boolean hasUnsavedChanges;
    private AdapterView.OnItemSelectedListener signalPickerListener;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            BLEService = binder.getService();
            isServiceBound = true;
            Log.i("service binding", "onServiceConnected");
            updateDeviceTypeFromConnection();
            initChart();
            refreshChart(); // Refresh the chart with the new buffer
            // Try to load last selected signal if not already loaded
            if (TextUtils.isEmpty(currentSignalName) && !savedSignalNames.isEmpty()) {
                loadLastSelectedSignal();
            }
        }
        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.i("service binding", "onServiceDisconnected");
        }
    };

    private final ServiceConnection usbServiceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            USBService.LocalBinder binder = (USBService.LocalBinder) service;
            USBService = binder.getService();
            isUsbServiceBound = true;
            Log.i("usb service binding", "onServiceConnected");
            updateDeviceTypeFromConnection();
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
        boolean pwmEnabled = pwmPrefs.getBoolean(PREF_TX_PWM_ENABLED, false);
        int pwmFreqHz = pwmPrefs.getInt(PREF_TX_PWM_FREQ_HZ, DEFAULT_TX_PWM_FREQ_HZ);
        int pwmDutyPercent = pwmPrefs.getInt(PREF_TX_PWM_DUTY_PERCENT, DEFAULT_TX_PWM_DUTY_PERCENT);
        binding.pwmSwitch.setChecked(pwmEnabled);
        binding.pwmFreqEdit.setText(String.valueOf(pwmFreqHz));
        binding.pwmDutyEdit.setText(String.valueOf(pwmDutyPercent));
        updatePwmUiState();
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

        binding.gpioSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                // Show retransmit button for all pins
                binding.retransmitButton.setVisibility(View.VISIBLE);

                // Save the selected pin index for the current device type
                SharedPreferences sp = PreferenceManager.getDefaultSharedPreferences(requireContext());
                SharedPreferences.Editor editor = sp.edit();
                int deviceType = getActiveDeviceType();
                if (deviceType == DEVICE_STM32) {
                    editor.putInt(PREF_SELECTED_PIN_INDEX_STM32, position);
                } else {
                    editor.putInt(PREF_SELECTED_PIN_INDEX_ESP32, position);
                    // Also update legacy key for backwards compatibility
                    editor.putInt(PREF_SELECTED_PIN_INDEX, position);
                    String selection = (String) parent.getItemAtPosition(position);
                    int io = getPinNumberFromSelection(selection);
                    if (io >= 0) {
                        editor.putInt(PREF_SELECTED_PIN_IO_ESP32, io);
                    }
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
        refreshSignalList(() -> {
            // After refreshing the list, try to load the last selected signal
            loadLastSelectedSignal();
        });
        updateStatusBar();

        return root;
    }

    private int getActiveDeviceType() {
        if (USBService != null && USBService.checkConnection()) {
            return DEVICE_STM32;
        }
        if (BLEService != null && BLEService.checkConnection()) {
            return DEVICE_ESP32;
        }
        return currentDeviceType;
    }

    private void updateDeviceTypeFromConnection() {
        if (!isAdded() || binding == null) {
            return;
        }

        currentDeviceType = getActiveDeviceType();
        if (currentDeviceType == DEVICE_STM32) {
            binding.deviceLabel.setText("Device: STM32 (USB)");
        } else if (currentDeviceType == DEVICE_ESP32) {
            binding.deviceLabel.setText("Device: ESP32 (BLE)");
        } else {
            binding.deviceLabel.setText("Device: —");
        }
        updateGpioSpinnerForCurrentDevice();
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
        if (BLEService != null) {
            BLEService.clearBuffer();
            lastBufferSize = -1; // Force refresh
            refreshChart(); // Refresh the chart to reflect the cleared buffer
            markBufferDirty();
        } else if (USBService != null) {
            USBService.clearBuffer();
            lastBufferSize = -1; // Force refresh
            refreshChart(); // Refresh the chart to reflect the cleared buffer
            markBufferDirty();
        } else {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
        }
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
                    if (BLEService == null && USBService == null) {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        refreshSignalList();
                        return;
                    }
                    
                    if (currentDeviceType == DEVICE_STM32 && USBService != null) {
                         USBService.loadBuffer(data);
                    } else if (currentDeviceType != DEVICE_STM32 && BLEService != null) { // Assume BLE for other cases
                         BLEService.loadBuffer(data);
                    } else {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        refreshSignalList(); // Refresh the signal list, as data loading failed
                        return;
                    }

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
        if (BLEService == null && USBService == null) {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        
        final byte[] buffer;
        if (currentDeviceType == DEVICE_STM32 && USBService != null) {
             buffer = USBService.getBuffer();
        } else if (BLEService != null) {
             buffer = BLEService.getBuffer();
        } else {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }

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
                    if (BLEService == null && USBService == null) {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    
                    if (currentDeviceType == DEVICE_STM32 && USBService != null) {
                         USBService.loadBuffer(data);
                    } else if (currentDeviceType != DEVICE_STM32 && BLEService != null) { // Assume BLE for other cases
                         BLEService.loadBuffer(data);
                    } else {
                        Toast.makeText(requireContext(), "Service not available", Toast.LENGTH_SHORT).show();
                        refreshSignalList(); // Refresh the signal list, as data loading failed
                        return;
                    }
                    
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

    private void refreshChart() {
        int currentBufferSize = 0;
        if (currentDeviceType == DEVICE_STM32) {
             if (USBService != null) currentBufferSize = USBService.getBufferLength();
        } else {
             if (BLEService != null) currentBufferSize = BLEService.getBufferLength();
        }
        
        if (currentDeviceType == DEVICE_STM32 && USBService == null) {
            // If USBService is not available for STM32, prevent chart refresh
            return;
        } else if (currentDeviceType != DEVICE_STM32 && BLEService == null) {
            // If BLEService is not available for ESP32, prevent chart refresh
            return;
        }

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
        updateDeviceTypeFromConnection();
        if (currentDeviceType == DEVICE_STM32) {
            if (USBService == null) {
                Toast.makeText(getContext(), "USB Service not available", Toast.LENGTH_SHORT).show();
                return;
            }
            
            // Note: STM32 Pins are simpler, we might need to adjust extraction if format changes
            // For now, assume format is "Name (PA0)" etc.
            // But getPinNumberFromSelection extracts "IOx".
            // STM32 strings are "IR RX (PA1)", "PA0 (TIM2 CH1)" etc.
            // My getPinNumberFromSelection regex is "\\(IO(\\d+)\\)"
            // It won't work for STM32 strings.
            // I need to update pin extraction or parsing for STM32.
            
            // For now, let's just send the index or a mapped value?
            // The previous STM32 code used pin number in bulk_packet.
            // I should stick to the "sample start --pin=X" string format.
            // I need to map the selection to a pin number the firmware understands.
            // Firmware: PA0=0, PA1=1, PA2=2, PA3=3.
            
            // Let's look at STM32_PINS:
            // "IR RX (PA1)" -> 1
            // "PA0 (TIM2 CH1)" -> 0
            // "PA2 (TIM2 CH3)" -> 2
            // "PA3 (TIM2 CH4)" -> 3
            
            int pinNumber = -1;
            String selected = binding.gpioSpinner.getSelectedItem().toString();
            if (selected.contains("PA0")) pinNumber = 0;
            else if (selected.contains("PA1")) pinNumber = 1;
            else if (selected.contains("PA2")) pinNumber = 2;
            else if (selected.contains("PA3")) pinNumber = 3;
            
            if (pinNumber == -1) {
                 Toast.makeText(getContext(), "Invalid STM32 pin selected", Toast.LENGTH_SHORT).show();
                 return;
            }

            String commandStr = "sample start --pin=" + pinNumber;
            byte[] command = commandStr.getBytes();
            USBService.write(command);
            
        } else {
            if (BLEService == null) {
                Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
                return;
            }
            String selectedPinString = binding.gpioSpinner.getSelectedItem().toString();
            byte pinNumber = getPinNumberFromSelection(selectedPinString);

            if (pinNumber == -1) { // Check if pin parsing failed
                Toast.makeText(getContext(), "Recording failed: Invalid pin selected.", Toast.LENGTH_SHORT).show();
                return; // Don't proceed
            }
            
            // Format command for ESP32: "sample start --pin=<pin>"
            String commandStr = "sample start --pin=" + pinNumber;
            byte[] command = commandStr.getBytes();
            BLEService.write(command);
        }
        
        // Set recording flag
        isRecording = true;
        
        // Disable record button while recording
        binding.recordButton.setEnabled(false);
        // Enable stop button
        binding.stopButton.setEnabled(true);
        
        Toast.makeText(getContext(), "Recording started", Toast.LENGTH_SHORT).show();
    }

    private void stopRecording() {
        updateDeviceTypeFromConnection();
        if (currentDeviceType == DEVICE_STM32) {
             if (USBService != null) {
                 byte[] command = "sample stop".getBytes();
                 USBService.write(command);
             }
        } else {
            if (BLEService != null) {
                // Use firmware command format: "sample stop"
                byte[] command = "sample stop".getBytes();
                BLEService.write(command);
            }
        }
            
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
            
            int pinNumber = -1;
            String selected = binding.gpioSpinner.getSelectedItem().toString();
            if (selected.contains("PA0")) pinNumber = 0;
            else if (selected.contains("PA1")) pinNumber = 1;
            else if (selected.contains("PA2")) pinNumber = 2;
            else if (selected.contains("PA3")) pinNumber = 3;
            
            if (pinNumber == -1) {
                 Toast.makeText(getContext(), "Invalid STM32 pin selected", Toast.LENGTH_SHORT).show();
                 return;
            }
            
            // Format command: "transmit start --pin=<pin>"
            String commandStr = "transmit start --pin=" + pinNumber;
            byte[] commandBytes = commandStr.getBytes();
            USBService.write(commandBytes);

            // Now call the transmitBuffer method
            USBService.transmitBuffer();
            
            Toast.makeText(getContext(), "Retransmitting " + bufferLength + " samples", Toast.LENGTH_SHORT).show();

        } else {
            if (BLEService == null) {
                Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
                return;
            }

            int bufferLength = BLEService.getBufferLength();
            Log.d("SamplerFragment", "BEFORE_RETRANSMIT: Buffer contains " + bufferLength + 
                  " bytes = " + (bufferLength * 8) + " bits");
              
            String selectedPinString = binding.gpioSpinner.getSelectedItem().toString();
            byte pinNumber = getPinNumberFromSelection(selectedPinString);

            if (pinNumber == -1) { // Check if pin parsing failed
                Toast.makeText(getContext(), "Retransmit failed: Invalid pin selected.", Toast.LENGTH_SHORT).show();
                return; // Don't proceed
            }
            
            // Format command for ESP32: "transmit start --pin=<pin>"
            String commandStr = "transmit start --pin=" + pinNumber;
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
            if (binding.pwmSwitch.isChecked()) {
                int freqHz = parsePwmIntOrDefault(binding.pwmFreqEdit.getText().toString(), DEFAULT_TX_PWM_FREQ_HZ);
                int dutyPercent = parsePwmIntOrDefault(binding.pwmDutyEdit.getText().toString(), DEFAULT_TX_PWM_DUTY_PERCENT);
                if (freqHz < 1) {
                    Toast.makeText(getContext(), "Invalid PWM frequency", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (dutyPercent < 1 || dutyPercent > 100) {
                    Toast.makeText(getContext(), "Invalid PWM duty (1-100)", Toast.LENGTH_SHORT).show();
                    return;
                }
                prefs.edit()
                        .putInt(PREF_TX_PWM_FREQ_HZ, freqHz)
                        .putInt(PREF_TX_PWM_DUTY_PERCENT, dutyPercent)
                        .apply();
                commandStr += " --pwm --freq=" + freqHz + " --duty=" + dutyPercent;
            }
            byte[] commandBytes = commandStr.getBytes();
            BLEService.write(commandBytes);

            // Now call the transmitBuffer method
            BLEService.transmitBuffer();
            
            // Log buffer state after transmission
            int postTransmitLength = BLEService.getBufferLength();
            Log.d("SamplerFragment", "AFTER_RETRANSMIT: Buffer contains " + postTransmitLength + 
                  " bytes = " + (postTransmitLength * 8) + " bits");

            Toast.makeText(getContext(), "Retransmitting " + bufferLength + " samples on " + selectedPinString, Toast.LENGTH_SHORT).show();
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
        if (currentDeviceType == DEVICE_STM32 && USBService != null) {
            result = (Object[]) USBService.compressDataBits(rangeStart, rangeEnd, numberBins);
        } else if (BLEService != null) {
            result = (Object[]) BLEService.compressDataBits(rangeStart, rangeEnd, numberBins);
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
        if (!isServiceBound && getActivity() != null) {
            Intent intent = new Intent(getActivity(), BLEService.class);
            getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        }
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
        final byte[] bufferData; // Declare as final and initialize once
        if (currentDeviceType == DEVICE_STM32) {
             if (USBService != null) {
                 bufferData = USBService.getBuffer();
             } else {
                 Toast.makeText(getContext(), "USB Service not available", Toast.LENGTH_SHORT).show();
                 return;
             }
        } else {
             if (BLEService != null) {
                 bufferData = BLEService.getBuffer();
             } else {
                 Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
                 return;
             }
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

        boolean supportsPwmRetransmit = currentDeviceType != DEVICE_STM32;
        binding.pwmSwitch.setEnabled(supportsPwmRetransmit);
        updatePwmUiState();

        String[] pins = (currentDeviceType == DEVICE_STM32) ? STM32_PINS : ESP32_PINS;

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

        if (currentDeviceType == DEVICE_STM32) {
            selectedPinIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX_STM32, 0);
        } else {
            Integer selectedIo = null;
            if (prefs.contains(PREF_SELECTED_PIN_IO_ESP32)) {
                int io = prefs.getInt(PREF_SELECTED_PIN_IO_ESP32, -1);
                if (io >= 0) {
                    selectedIo = io;
                }
            }

            if (selectedIo == null) {
                int legacyIndex;
                if (prefs.contains(PREF_SELECTED_PIN_INDEX_ESP32)) {
                    legacyIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX_ESP32, -1);
                } else {
                    legacyIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX, -1);
                }

                if (legacyIndex >= 0 && legacyIndex < LEGACY_ESP32_PINS.length) {
                    int io = getPinNumberFromSelection(LEGACY_ESP32_PINS[legacyIndex]);
                    if (io >= 0) {
                        prefs.edit().putInt(PREF_SELECTED_PIN_IO_ESP32, io).apply();
                        selectedIo = io;
                    }
                }
            }

            if (selectedIo != null) {
                selectedPinIndex = findEsp32IndexForIo(selectedIo);
            } else if (prefs.contains(PREF_SELECTED_PIN_INDEX_ESP32)) {
                selectedPinIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX_ESP32, findEsp32IndexForIo(6));
            } else {
                selectedPinIndex = prefs.getInt(PREF_SELECTED_PIN_INDEX, findEsp32IndexForIo(6));
            }
        }

        if (selectedPinIndex >= 0 && selectedPinIndex < gpioAdapter.getCount()) {
            binding.gpioSpinner.setSelection(selectedPinIndex);
        } else if (gpioAdapter.getCount() > 0) {
            binding.gpioSpinner.setSelection(0);
        }
    }

    private void updatePwmUiState() {
        if (!isAdded() || binding == null) {
            return;
        }

        boolean supportsPwmRetransmit = currentDeviceType != DEVICE_STM32;
        boolean pwmEnabled = supportsPwmRetransmit && binding.pwmSwitch.isChecked();
        binding.pwmOptionsGroup.setVisibility(pwmEnabled ? View.VISIBLE : View.GONE);
        binding.pwmFreqEdit.setEnabled(pwmEnabled);
        binding.pwmDutyEdit.setEnabled(pwmEnabled);
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

    private byte getPinNumberFromSelection(String selectedPinString) {
        // Extracts the IO number from strings like "IO4 IR TX" or "IR TX (IO4)".
        Pattern pattern = Pattern.compile("\\bIO(\\d+)\\b");
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

    private static final String[] LEGACY_ESP32_PINS = {
            "RFM69 DIO0 / CC1101 GDO0 (IO1)",
            "RFM69 DIO1 / CC1101 GDO2 (IO2)",
            "RFM69 DIO2 (IO42)",
            "RFM69 DIO3 (IO41)",
            "RFM69 DIO4 (IO40)",
            "RFM69 DIO5 (IO39)",
            "IR RX (IO38)",
            "IR TX (IO37)",
            "GPIO4 / IR TX (IO4)",
            "GPIO5 / IR RX (IO5)",
            "GPIO6 (IO6)",
            "GPIO7 (IO7)",
            "GPIO15 (IO15)",
            "GPIO16 (IO16)",
            "GPIO17 (IO17)",
            "GPIO18 (IO18)",
            "GPIO8 (IO8)",
            "GPIO3 (IO3)",
            "GPIO46 (IO46)",
            "GPIO9 (IO9)",
            "GPIO10 / CC1101 NSS (IO10)",
            "GPIO11 / CC1101 MOSI (IO11)",
            "GPIO12 / CC1101 SCK (IO12)",
            "GPIO13 / CC1101 MISO (IO13)",
            "GPIO14 (IO14)"
    };

    private int findEsp32IndexForIo(int ioPin) {
        for (int i = 0; i < ESP32_PINS.length; i++) {
            if (getPinNumberFromSelection(ESP32_PINS[i]) == (byte) ioPin) {
                return i;
            }
        }
        return 0;
    }

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
        if (currentDeviceType == DEVICE_STM32 && USBService != null) {
             USBService.clearBuffer();
        } else if (BLEService != null) { // Assume BLE for other cases
             BLEService.clearBuffer();
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
        if (BLEService == null && USBService == null) {
            Toast.makeText(getContext(), "Service not available", Toast.LENGTH_SHORT).show();
            return;
        }
        
        byte[] buffer = null;
        if (currentDeviceType == DEVICE_STM32 && USBService != null) {
             buffer = USBService.getBuffer();
        } else if (BLEService != null) {
             buffer = BLEService.getBuffer();
        }

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
