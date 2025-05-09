package com.emwaver.emwaverandroidapp.ui.ble;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MenuInflater;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.CheckBox;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.widget.AdapterView;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.core.content.ContextCompat;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.BLEReceiver;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BLEFragment extends Fragment {

    private Spinner pinSpinner;
    private Button readButton, writeHighButton, writeLowButton;
    private EditText commandInput;
    private Button sendPacketButton;
    private TextView bleStatusText;
    
    private BLEService bleService;
    private boolean isServiceBound = false;

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

    private static final String TAG = "BLEFragment";

    private TextView serialMonitor;
    private ScrollView serialMonitorScroll;

    private CheckBox showHex;
    private CheckBox showAscii;

    private static final int MONITOR_UPDATE_INTERVAL = 100; // 100ms
    private Handler monitorHandler;
    private Runnable monitorRunnable;
    
    // Handler for periodic status updates
    private Handler statusUpdateHandler;
    private static final int STATUS_UPDATE_INTERVAL = 1000; // 1 second

    private BLEReceiver bleReceiver;

    private static final String PREF_SELECTED_BLE_PIN_INDEX = "selectedBlePinIndex";

    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_ble, container, false);

        // Initialize UI elements
        pinSpinner = root.findViewById(R.id.pin_spinner);
        readButton = root.findViewById(R.id.read_button);
        writeHighButton = root.findViewById(R.id.write_high_button);
        writeLowButton = root.findViewById(R.id.write_low_button);
        commandInput = root.findViewById(R.id.command_input);
        sendPacketButton = root.findViewById(R.id.send_packet_button);
        serialMonitor = root.findViewById(R.id.serial_monitor);
        serialMonitorScroll = root.findViewById(R.id.serial_monitor_scroll);
        showHex = root.findViewById(R.id.show_hex);
        showAscii = root.findViewById(R.id.show_ascii);
        bleStatusText = root.findViewById(R.id.ble_status_text);

        setupSpinner();
        setupButtons();
        setupSendCommandButton();
        setupMonitorUpdates();
        setupStatusUpdates();

        // Load saved pin selection or set default
        SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
        int defaultPinIndex = 0; // Default to the first pin in the list
        int selectedPinIndex = prefs.getInt(PREF_SELECTED_BLE_PIN_INDEX, defaultPinIndex);
        if (selectedPinIndex >= 0 && selectedPinIndex < pinSpinner.getAdapter().getCount()) {
            pinSpinner.setSelection(selectedPinIndex);
        } else {
            pinSpinner.setSelection(defaultPinIndex); // Fallback to default
        }

        return root;
    }

    private void setupStatusUpdates() {
        statusUpdateHandler = new Handler(Looper.getMainLooper());
        Runnable statusUpdateRunnable = new Runnable() {
            @Override
            public void run() {
                updateConnectionStatus();
                statusUpdateHandler.postDelayed(this, STATUS_UPDATE_INTERVAL);
            }
        };
        statusUpdateHandler.post(statusUpdateRunnable);
    }

    @Override
    public void onViewCreated(@NonNull View view, Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        MenuHost menuHost = requireActivity();
        menuHost.addMenuProvider(new MenuProvider() {
            @Override
            public void onCreateMenu(@NonNull Menu menu, @NonNull MenuInflater menuInflater) {
                menu.add(Menu.NONE, R.id.clear_serial, Menu.NONE, "Clear")
                        .setIcon(R.drawable.ai_discard)
                        .setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
            }

            @Override
            public boolean onMenuItemSelected(@NonNull MenuItem menuItem) {
                if (menuItem.getItemId() == R.id.clear_serial) {
                    clearSerialMonitor();
                    return true;
                }
                return false;
            }
        }, getViewLifecycleOwner());
    }

    @Override
    public void onStart() {
        super.onStart();
        Intent intent = new Intent(getActivity(), BLEService.class);
        getActivity().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        
        // Also start the service to ensure it's running even when not bound
        getActivity().startService(intent);
    }

    @Override
    public void onStop() {
        super.onStop();
        if (isServiceBound) {
            getActivity().unbindService(serviceConnection);
            isServiceBound = false;
        }
        if (monitorHandler != null) {
            monitorHandler.removeCallbacks(monitorRunnable);
        }
        if (statusUpdateHandler != null) {
            statusUpdateHandler.removeCallbacksAndMessages(null);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        updateConnectionStatus();
        
        // Register receiver for BLE connection status updates
        bleReceiver = new BLEReceiver(this::updateConnectionUI);
        IntentFilter filter = new IntentFilter(BLEReceiver.ACTION_BLE_CONNECTION_STATUS);
        requireActivity().registerReceiver(bleReceiver, filter);
    }

    @Override
    public void onPause() {
        super.onPause();
        
        // Unregister receiver
        if (bleReceiver != null) {
            requireActivity().unregisterReceiver(bleReceiver);
            bleReceiver = null;
        }
    }

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName className, IBinder service) {
            BLEService.LocalBinder binder = (BLEService.LocalBinder) service;
            bleService = binder.getService();
            isServiceBound = true;
            Log.d(TAG, "BLE Service Connected");
            updateConnectionStatus();
        }

        @Override
        public void onServiceDisconnected(ComponentName arg0) {
            isServiceBound = false;
            Log.d(TAG, "BLE Service Disconnected");
        }
    };

    private void updateConnectionStatus() {
        if (isServiceBound && bleService != null) {
            boolean connected = bleService.checkConnection();
            
            if (bleStatusText != null) {
                bleStatusText.setText(connected ? "Connected" : "Not connected");
                // Change text color based on connection status
                bleStatusText.setTextColor(connected ? 
                        ContextCompat.getColor(requireContext(), android.R.color.holo_green_dark) : 
                        ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
            }
        } else {
            if (bleStatusText != null) {
                bleStatusText.setText("Service not bound");
                bleStatusText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
            }
        }
        
        // Removing actionbar status updates
        // Utils.updateActionBarStatus(this, statusMessage);
    }

    private void setupSpinner() {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(),
                android.R.layout.simple_spinner_item, PINS);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        pinSpinner.setAdapter(adapter);

        pinSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                // Save the selected pin index
                SharedPreferences prefs = PreferenceManager.getDefaultSharedPreferences(requireContext());
                SharedPreferences.Editor editor = prefs.edit();
                editor.putInt(PREF_SELECTED_BLE_PIN_INDEX, position);
                editor.apply();
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
                // Do nothing
            }
        });
    }

    private void setupButtons() {
        readButton.setOnClickListener(v -> sendGpioCommand("R", (byte) 0));
        writeHighButton.setOnClickListener(v -> sendGpioCommand("W", (byte) 1));
        writeLowButton.setOnClickListener(v -> sendGpioCommand("W", (byte) 0));
    }

    private void setupSendCommandButton() {
        sendPacketButton.setOnClickListener(v -> {
            String userInput = commandInput.getText().toString().trim();
            if (userInput.isEmpty()) {
                Toast.makeText(getContext(), "Please enter a packet.", Toast.LENGTH_SHORT).show();
                return;
            }

            // Log the user input
            String timestamp = new java.text.SimpleDateFormat("HH:mm:ss.SSS")
                .format(new java.util.Date());
            appendToSerialMonitor(String.format("[%s] TX: %s", timestamp, userInput));

            byte[] commandBytes = parseCommand(userInput);
            if (commandBytes == null) {
                Toast.makeText(getContext(), "Invalid packet format.", Toast.LENGTH_SHORT).show();
                return;
            }

            Log.d(TAG, "Sending packet: " + bytesToHex(commandBytes));
            if (isServiceBound && bleService != null) {
                bleService.sendPacket(commandBytes);
            } else {
                Toast.makeText(getContext(), "BLE Service not connected", Toast.LENGTH_SHORT).show();
            }
        });
    }

    /**
     * Parses the user input into a byte array.
     * Supports:
     * - Hexadecimal in brackets (e.g., [0x1A], [0xFF])
     * - Decimal in brackets (e.g., [26], [255])
     * - Mixed format (e.g., read[0x00][255][0xFF])
     * - ASCII strings without brackets (e.g., req)
     *
     * @param input The command input string.
     * @return Byte array representation of the command, or null if invalid.
     */
    private byte[] parseCommand(String input) {
        List<Byte> byteList = new ArrayList<>();

        try {
            // Check if the input contains any bracketed values
            if (input.contains("[") && input.contains("]")) {
                // Split the input by square brackets
                String[] parts = input.split("\\[|\\]");
                for (String part : parts) {
                    part = part.trim();
                    if (part.isEmpty()) continue;

                    if (part.startsWith("0x") || part.startsWith("0X")) {
                        // Hexadecimal value
                        byteList.add((byte) Integer.parseInt(part.substring(2), 16));
                    } else if (part.matches("\\d+")) {
                        // Decimal value
                        int val = Integer.parseInt(part);
                        if (val < 0 || val > 255) {
                            throw new IllegalArgumentException("Decimal value out of byte range: " + val);
                        }
                        byteList.add((byte) val);
                    } else {
                        // Treat as ASCII if it's not in brackets
                        byteList.addAll(convertStringToByteList(part));
                    }
                }
            } else {
                // If no brackets, treat the entire input as ASCII
                byteList.addAll(convertStringToByteList(input));
            }

            // Convert List<Byte> to byte[]
            byte[] bytes = new byte[byteList.size()];
            for (int i = 0; i < byteList.size(); i++) {
                bytes[i] = byteList.get(i);
            }
            return bytes;
        } catch (IllegalArgumentException e) {
            Log.e(TAG, "parseCommand: Error parsing input", e);
            return null;
        }
    }

    private List<Byte> convertStringToByteList(String input) {
        List<Byte> byteList = new ArrayList<>();
        for (char c : input.toCharArray()) {
            byteList.add((byte) c);
        }
        return byteList;
    }

    private void sendGpioCommand(String action, byte value) {
        if (isServiceBound && bleService != null) {
            String selectedPin = (String) pinSpinner.getSelectedItem();
            // Log the user action
            String timestamp = new java.text.SimpleDateFormat("HH:mm:ss.SSS")
                .format(new java.util.Date());
            appendToSerialMonitor(String.format("[%s] Command: %s %s to %s", 
                timestamp, 
                action.equals("R") ? "Read" : "Write",
                action.equals("R") ? "" : (value != 0 ? "HIGH" : "LOW"),
                selectedPin));

            // Extract GPIO pin number from the selected pin (e.g., "GPIO12" -> 12)
            byte pinNumber = getPinNumberFromSelection(selectedPin);

            if (pinNumber == -1) { // Check if pin parsing failed
                Toast.makeText(getContext(), "GPIO command failed: Invalid pin selected.", Toast.LENGTH_SHORT).show();
                updateResponse("GPIO command failed: Invalid pin selected.", "N/A");
                return; // Don't proceed
            }

            // Create command similar to ESP32 code's expectation
            byte[] command = new byte[]{
                    'g', 'p', 'i', 'o',
                    0, // This is ignored in ESP32
                    pinNumber,
                    (byte) action.charAt(0),
                    value
            };

            Log.d(TAG, "Sending GPIO command: " + bytesToHex(command));
            byte[] response = bleService.sendCommand(command, 2000);

            if (response != null && response.length > 0) {
                boolean state = response[0] != 0;
                String resultMessage;
                if (action.equals("R")) {
                    resultMessage = selectedPin + " state: " + (state ? "High" : "Low");
                } else {
                    boolean writeSuccess = (state == (value != 0));
                    String writeAction = (value != 0) ? "high" : "low";
                    resultMessage = "Write " + writeAction + " to " + selectedPin +
                            (writeSuccess ? " successful" : " failed");
                }
                Log.d(TAG, "GPIO command response: " + resultMessage);
                updateResponse(bytesToHex(response), bytesToAscii(response));
            } else {
                Log.e(TAG, "GPIO command failed or timed out");
                updateResponse("GPIO command failed or timed out", "N/A");
            }
        } else {
            Log.e(TAG, "BLE Service not bound");
            updateResponse("BLE Service not connected", "N/A");
        }
    }

    /**
     * Updates the response TextViews with the provided messages.
     *
     * @param hexMessage The hex message to display.
     * @param asciiMessage The ASCII message to display.
     */
    private void updateResponse(final String hexMessage, final String asciiMessage) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                String timestamp = new java.text.SimpleDateFormat("HH:mm:ss.SSS")
                    .format(new java.util.Date());
                
                StringBuilder output = new StringBuilder();
                output.append(String.format("[%s] ", timestamp));
                
                if (showHex.isChecked()) {
                    output.append("HEX: ").append(hexMessage);
                    if (showAscii.isChecked()) {
                        output.append(" | ");
                    }
                }
                
                if (showAscii.isChecked()) {
                    output.append("ASCII: ").append(asciiMessage);
                }
                
                appendToSerialMonitor(output.toString());
            });
        }
    }

    /**
     * Converts a byte array to a hexadecimal string representation.
     *
     * @param bytes The byte array to convert.
     * @return Hexadecimal string.
     */
    private static String bytesToHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02X ", b));
        }
        return sb.toString().trim();
    }

    /**
     * Converts a byte array to an ASCII string representation.
     *
     * @param bytes The byte array to convert.
     * @return ASCII string.
     */
    private static String bytesToAscii(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            if (b >= 32 && b <= 126) { // Printable ASCII range
                sb.append((char) b);
            } else {
                sb.append('.');
            }
        }
        return sb.toString();
    }

    private void clearSerialMonitor() {
        if (serialMonitor != null) {
            serialMonitor.setText("");
        }
    }

    private void appendToSerialMonitor(String message) {
        if (serialMonitor != null && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                serialMonitor.append(message + "\n");
                serialMonitorScroll.post(() -> 
                    serialMonitorScroll.fullScroll(View.FOCUS_DOWN));
            });
        }
    }

    private void setupMonitorUpdates() {
        monitorHandler = new Handler(Looper.getMainLooper());
        monitorRunnable = new Runnable() {
            @Override
            public void run() {
                if (isServiceBound && bleService != null) {
                    byte[] data = bleService.getCommand();
                    if (data != null && data.length > 0) {
                        String hexData = bytesToHex(data);
                        String asciiData = bytesToAscii(data);
                        updateResponse(hexData, asciiData);
                    }
                }
                monitorHandler.postDelayed(this, MONITOR_UPDATE_INTERVAL);
            }
        };
        monitorHandler.post(monitorRunnable);
    }

    // Helper method to update UI based on connection status from broadcast
    private void updateConnectionUI(boolean connected) {
        if (bleStatusText != null) {
            bleStatusText.setText(connected ? "Connected" : "Not connected");
            bleStatusText.setTextColor(connected ? 
                    ContextCompat.getColor(requireContext(), android.R.color.holo_green_dark) : 
                    ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
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
                Log.e(TAG, "Failed to parse IO number from: " + selectedPinString + " extracted part: " + matcher.group(1), e);
            }
        }
        Log.e(TAG, "Could not extract IO number from: " + selectedPinString + ". Check PINS array format and regex.");
        Toast.makeText(getContext(), "Error: Could not parse pin number from '" + selectedPinString + "'", Toast.LENGTH_LONG).show();
        return -1; // Indicates an error
    }
} 