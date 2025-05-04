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
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.preference.PreferenceManager;
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
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.view.MenuProvider;
import androidx.fragment.app.Fragment;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.ViewModelProvider;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.databinding.FragmentSamplerBinding;
import com.github.mikephil.charting.charts.LineChart;
import com.github.mikephil.charting.components.XAxis;
import com.github.mikephil.charting.components.YAxis;
import com.github.mikephil.charting.data.Entry;
import com.github.mikephil.charting.data.LineData;
import com.github.mikephil.charting.data.LineDataSet;
import com.github.mikephil.charting.listener.ChartTouchListener;
import com.github.mikephil.charting.listener.OnChartGestureListener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
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

    // Add PINS array to match UsbFragment
    private static final String[] PINS = {
            "GPIO0", "GPIO1 (CC1101 GDO0)", "GPIO2", "GPIO3", "GPIO4 (IR Transmitter)", "GPIO5 (IR Receiver)", "GPIO6", "GPIO7", 
            "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "GPIO15", 
            "GPIO16", "GPIO17", "GPIO18", "GPIO19", "GPIO20", "GPIO21",
            "GPIO26", "GPIO27", "GPIO28", "GPIO29", "GPIO30", "GPIO31", "GPIO32", "GPIO33",
            "GPIO34", "GPIO35", "GPIO36", "GPIO37", "GPIO38", "GPIO39", "GPIO40", "GPIO41",
            "GPIO42", "GPIO43", "GPIO44", "GPIO45", "GPIO46", "GPIO47", "GPIO48"
    };

    private static final int DEFAULT_REFRESH_DELAY = 100; // milliseconds
    private int refreshDelay = DEFAULT_REFRESH_DELAY;
    private ScheduledExecutorService scheduler;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Handler backgroundHandler = new Handler(Looper.getMainLooper());
    private Runnable pendingCompressionTask;

    private ActivityResultLauncher<Intent> createFileLauncher;
    private ActivityResultLauncher<String[]> openFileLauncher;

    private int lastBufferSize = 0;

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
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {

        // Initialize view binding
        binding = FragmentSamplerBinding.inflate(inflater, container, false);
        View root = binding.getRoot();

        chart = binding.chart;

        // Replace the resource-based spinner adapter with the PINS array
        ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(),
                android.R.layout.simple_spinner_item, PINS);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        binding.gpioSpinner.setAdapter(adapter);

        // Set default selection to GPIO6 (index 6 in the array)
        binding.gpioSpinner.setSelection(6);

        binding.gpioSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                String selectedPin = parent.getItemAtPosition(position).toString();
                // Show retransmit button for all pins
                binding.retransmitButton.setVisibility(View.VISIBLE);
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

                    updateChartWithCompression(visibleRangeStart, visibleRangeEnd, visiblePoints);
                }
            }
        });

        createFileLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                Uri uri = result.getData().getData();
                if (uri != null) {
                    final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                    getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                    saveFileToUri(uri);
                }
            }
        });

        openFileLauncher = registerForActivityResult(new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri != null) {
                final int takeFlags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                getContext().getContentResolver().takePersistableUriPermission(uri, takeFlags);
                loadFileToBuffer(uri);
                refreshChart();
            }
        });

        initScheduler();

        setupMenu();

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
                } else if (id == R.id.action_load_from_storage) {
                    openFile();
                    return true;
                } else if (id == R.id.action_save_to_storage) {
                    saveAsFile();
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
            refreshChart(); // Refresh the chart to reflect the cleared buffer
        } else {
            Toast.makeText(getContext(), "BLE Service not available", Toast.LENGTH_SHORT).show();
        }
    }

    private void initScheduler() {
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdownNow();
        }
        
        // Get refresh delay from preferences
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        refreshDelay = Integer.parseInt(prefs.getString("refresh_time", String.valueOf(DEFAULT_REFRESH_DELAY)));
        
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(this::refreshChartWrapper, 0, refreshDelay, TimeUnit.MILLISECONDS);
    }

    private void refreshChartWrapper() {
        mainHandler.post(this::refreshChart);
    }

    private void refreshChart() {
        if (BLEService == null) {
            return;
        }

        int currentBufferSize = BLEService.getBufferLength();
        if (currentBufferSize != lastBufferSize) {
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
    }

    private void startRecording() {
        if (BLEService != null) {
            String selectedPin = binding.gpioSpinner.getSelectedItem().toString();
            // Extract GPIO pin number, handling the case with descriptive labels
            String pinText = selectedPin.substring(4).split(" ")[0]; // Get just the number part
            byte pinNumber = (byte) Integer.parseInt(pinText);
            
            // Format command for ESP32 (raw + pin number)
            byte[] command = new byte[]{'r', 'a', 'w', pinNumber};
            BLEService.write(command);
            
            Toast.makeText(getContext(), "Recording started on " + selectedPin, Toast.LENGTH_SHORT).show();
        }
    }

    private void stopRecording() {
        if (BLEService != null) {
            byte[] command = "s".getBytes();
            BLEService.write(command);
            
            Toast.makeText(getContext(), "Recording stopped", Toast.LENGTH_SHORT).show();
        }
    }

    private void retransmitSignal() {
        int bufferLength = BLEService.getBufferLength();
        Log.d("SamplerFragment", "BEFORE_RETRANSMIT: Buffer contains " + bufferLength + 
              " bytes = " + (bufferLength * 8) + " bits");
          
        String selectedPin = binding.gpioSpinner.getSelectedItem().toString();
        
        // Extract GPIO pin number, handling the case with descriptive labels
        String pinText = selectedPin.substring(4).split(" ")[0]; // Get just the number part
        byte pinNumber = (byte) Integer.parseInt(pinText);
        
        // Send the 'tran' command with just the pin number
        byte[] commandBytes = new byte[5];
        System.arraycopy("tran".getBytes(), 0, commandBytes, 0, 4);
        commandBytes[4] = pinNumber;
        BLEService.write(commandBytes);

        // Now call the transmitBuffer method
        BLEService.transmitBuffer();
        
        // Log buffer state after transmission
        int postTransmitLength = BLEService.getBufferLength();
        Log.d("SamplerFragment", "AFTER_RETRANSMIT: Buffer contains " + postTransmitLength + 
              " bytes = " + (postTransmitLength * 8) + " bits");

        Toast.makeText(getContext(), "Retransmitting " + bufferLength + " samples on " + selectedPin, Toast.LENGTH_SHORT).show();
    }

    public void initChart() {
        // Configure the chart (optional, based on your needs)
        chart.getDescription().setEnabled(false);
        chart.setTouchEnabled(true);
        chart.setPinchZoom(true);
        chart.setScaleYEnabled(false); // Disable Y-axis scaling
        chart.setScaleXEnabled(true);  // Enable X-axis scaling

        XAxis xAxis = chart.getXAxis();
        xAxis.setAxisMinimum(chartMinX); // Start at 0 microseconds
        xAxis.setAxisMaximum(chartMaxX); // End at the maximum X value

        YAxis leftAxis = chart.getAxisLeft();
        leftAxis.setAxisMinimum(-128); // Set minimum value for the left Y-axis
        leftAxis.setAxisMaximum(256+128); // Set maximum value for the left Y-axis

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
        LineDataSet lineDataSet = new LineDataSet(entries, "Demodulator");
        lineDataSet.setDrawValues(false);
        lineDataSet.setLineWidth(3f);
        lineDataSet.setColor(Color.parseColor("#0087FF"));
        lineDataSet.setCircleColor(Color.parseColor("#0087FF"));

        // If there is exactly one pulse (two transitions), update the legend
        if (transitionCount == 2) {
            lineDataSet.setLabel("Pulse Length: " + pulseLength + " samples");
        }

        return lineDataSet;
    }

    private void updateChart(LineDataSet lineDataSet) {
        LineData lineData = new LineData(lineDataSet);
        chart.setData(lineData);
        chart.notifyDataSetChanged();
        chart.invalidate();
    }

    private void updateChartWithCompression(int visibleRangeStart, int visibleRangeEnd, int points) {
        // Cancel any pending compression task
        if (pendingCompressionTask != null) {
            backgroundHandler.removeCallbacks(pendingCompressionTask);
        }

        // Create new compression task
        pendingCompressionTask = () -> {
            // Run compression in background thread
            new Thread(() -> {
                final LineDataSet compressedData = compressDataAndGetDataSet(visibleRangeStart, visibleRangeEnd, points);
                
                // Update chart on main thread
                mainHandler.post(() -> {
                    updateChart(compressedData);
                });
            }).start();
        };

        // Schedule the compression task with debouncing using the same delay as refresh
        backgroundHandler.postDelayed(pendingCompressionTask, refreshDelay);
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
        if (scheduler == null || scheduler.isShutdown()) {
            initScheduler();
        } else {
            // Check if refresh delay has changed
            SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
            int newRefreshDelay = Integer.parseInt(prefs.getString("refresh_time", String.valueOf(DEFAULT_REFRESH_DELAY)));
            if (newRefreshDelay != refreshDelay) {
                // Reinitialize scheduler with new delay
                initScheduler();
            }
        }
    }
    @Override
    public void onPause() {
        super.onPause();
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdownNow();
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (scheduler != null && !scheduler.isShutdown()) {
            scheduler.shutdownNow();
        }
    }

    public void openFile() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*"); // MIME type for .raw files or use "*/*" for any file type
        openFileLauncher.launch(new String[]{"*/*"}); // Pass the MIME type as an array
    }

    public void saveAsFile() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*"); // Set MIME Type as per your requirement
        intent.putExtra(Intent.EXTRA_TITLE, "mySignal.raw");

        createFileLauncher.launch(intent);
    }

    private void saveFileToUri(Uri uri) {
        try (OutputStream outstream = getActivity().getContentResolver().openOutputStream(uri)) {
            outstream.write(BLEService.getBuffer());
        } catch (IOException e) {
            Log.e("filesys", "Error writing to file", e);
        }
    }

    private void loadFileToBuffer(Uri uri) {
        if(uri != null){
            try (InputStream instream = getActivity().getContentResolver().openInputStream(uri)) {
                byte[] fileData = readBytes(instream);
                // Now send this data to your native code to populate dataBuffer
                BLEService.loadBuffer(fileData);
                refreshChart();
            } catch (IOException e) {
                Log.e("filesys", "Error reading from file", e);
            }
        }else{
            //showToastOnUiThread("");
        }
    }

    private byte[] readBytes(InputStream inputStream) throws IOException {
        ByteArrayOutputStream byteBuffer = new ByteArrayOutputStream();
        int bufferSize = 1024;
        byte[] buffer = new byte[bufferSize];

        int len = 0;
        while ((len = inputStream.read(buffer)) != -1) {
            byteBuffer.write(buffer, 0, len);
        }

        return byteBuffer.toByteArray();
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

        StringBuilder timings = new StringBuilder();
        int count = 0;
        boolean currentState = (bufferData[0] & 0x01) != 0;
        
        for (int i = 0; i < bufferData.length * 8; i++) {
            int byteIndex = i / 8;
            int bitIndex = i % 8;
            boolean bit = ((bufferData[byteIndex] >> bitIndex) & 1) != 0;

            if (bit == currentState) {
                count++;
            } else {
                timings.append(currentState ? "" : "-").append(count * 10).append(" ");
                currentState = bit;
                count = 1;
            }
        }

        // Add the last timing
        if (count > 0) {
            timings.append(currentState ? "" : "-").append(count * 10);
        }

        showTimingsDialog(timings.toString());
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
}