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

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;

import java.util.ArrayList;
import java.util.List;

public class BLEFragment extends Fragment {

    private Spinner pinSpinner;
    private Button readButton, writeHighButton, writeLowButton;
    private EditText commandInput;
    private Button sendPacketButton;
    private Button bleConnectButton;
    private TextView bleStatusText;
    
    private BLEService bleService;
    private boolean isServiceBound = false;

    private static final String[] PINS = {
            "GPIO0", "GPIO1", "GPIO2", "GPIO3", "GPIO4", "GPIO5", "GPIO6", "GPIO7", 
            "GPIO8", "GPIO9", "GPIO10", "GPIO11", "GPIO12", "GPIO13", "GPIO14", "GPIO15", 
            "GPIO16", "GPIO17", "GPIO18", "GPIO19", "GPIO20", "GPIO21",
            "GPIO26", "GPIO27", "GPIO28", "GPIO29", "GPIO30", "GPIO31", "GPIO32", "GPIO33",
            "GPIO34", "GPIO35", "GPIO36", "GPIO37", "GPIO38", "GPIO39", "GPIO40", "GPIO41",
            "GPIO42", "GPIO43", "GPIO44", "GPIO45", "GPIO46", "GPIO47", "GPIO48"
    };

    private static final String TAG = "BLEFragment";

    private TextView serialMonitor;
    private ScrollView serialMonitorScroll;

    private CheckBox showHex;
    private CheckBox showAscii;

    private static final int MONITOR_UPDATE_INTERVAL = 100; // 100ms
    private Handler monitorHandler;
    private Runnable monitorRunnable;

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
        bleConnectButton = root.findViewById(R.id.ble_connect_button);
        bleStatusText = root.findViewById(R.id.ble_status_text);

        setupSpinner();
        setupButtons();
        setupSendCommandButton();
        setupMonitorUpdates();
        setupBleButton();

        return root;
    }

    private void setupBleButton() {
        bleConnectButton.setOnClickListener(v -> {
            if (isServiceBound && bleService != null) {
                bleService.startScan();
                bleStatusText.setText("Scanning for EMWaver device...");
                Toast.makeText(getContext(), "Scanning for EMWaver BLE device...", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(getContext(), "BLE Service not bound", Toast.LENGTH_SHORT).show();
            }
        });
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
    }

    @Override
    public void onResume() {
        super.onResume();
        updateConnectionStatus();
    }

    @Override
    public void onPause() {
        super.onPause();
        Utils.updateActionBarStatus(this, "");
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
        String statusMessage;
        
        if (isServiceBound && bleService != null) {
            boolean connected = bleService.checkConnection();
            statusMessage = connected ? "Connected to EMWaver BLE" : "BLE not connected";
            
            if (bleStatusText != null) {
                bleStatusText.setText(connected ? "Connected" : "Not connected");
            }
        } else {
            statusMessage = "BLE Service not bound";
            if (bleStatusText != null) {
                bleStatusText.setText("Service not bound");
            }
        }
        
        Utils.updateActionBarStatus(this, statusMessage);
    }

    private void setupSpinner() {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(),
                android.R.layout.simple_spinner_item, PINS);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        pinSpinner.setAdapter(adapter);
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
            int pinNumber = Integer.parseInt(selectedPin.substring(4));

            // Create command similar to ESP32 code's expectation
            byte[] command = new byte[]{
                    'g', 'p', 'i', 'o',
                    0, // This is ignored in ESP32
                    (byte) pinNumber,
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
} 