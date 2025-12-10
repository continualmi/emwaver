package com.emwaver.emwaverandroidapp.ui.emwaver;

import android.content.Context;
import android.content.IntentFilter;
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
import android.widget.ImageButton;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.widget.AdapterView;
import android.text.Html;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.core.content.ContextCompat;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.BLEReceiver;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class EMWaverFragment extends Fragment {


    private EditText commandInput;
    private Button sendPacketButton;
    private TextView emwaverStatusText;
    private Button disconnectButton;
    private Button connectButton;
    private TextView firmwareVersionText;
    private ImageButton checkVersionButton;
    
    private DeviceConnectionManager connectionManager;
    private DeviceConnectionService activeService;



    private static final String TAG = "EMWaverFragment";

    private TextView serialMonitor;
    private ScrollView serialMonitorScroll;

    private CheckBox showHex;

    private static final int MONITOR_UPDATE_INTERVAL = 100; // 100ms
    private Handler monitorHandler;
    private Runnable monitorRunnable;
    
    // Handler for periodic status updates
    private Handler statusUpdateHandler;
    private static final int STATUS_UPDATE_INTERVAL = 1000; // 1 second

    private BLEReceiver bleReceiver;



    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_emwaver, container, false);

        // Initialize UI elements
        commandInput = root.findViewById(R.id.command_input);
        sendPacketButton = root.findViewById(R.id.send_packet_button);
        serialMonitor = root.findViewById(R.id.serial_monitor);
        serialMonitorScroll = root.findViewById(R.id.serial_monitor_scroll);
        showHex = root.findViewById(R.id.show_hex);
        emwaverStatusText = root.findViewById(R.id.emwaver_status_text);
        disconnectButton = root.findViewById(R.id.disconnect_button);
        connectButton = root.findViewById(R.id.connect_button);
        firmwareVersionText = root.findViewById(R.id.firmware_version_text);
        checkVersionButton = root.findViewById(R.id.check_version_button);


        setupSendCommandButton();
        setupMonitorUpdates();
        setupStatusUpdates();
        setupDisconnectButton();
        setupConnectButton();
        setupVersionButton();

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
        // Get connection manager instance
        connectionManager = DeviceConnectionManager.getInstance(requireContext());
        // Update active service reference
        activeService = connectionManager.getActiveService();
    }

    @Override
    public void onStop() {
        super.onStop();
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
        // Update active service reference
        if (connectionManager != null) {
            activeService = connectionManager.getActiveService();
        }
        updateConnectionStatus();
        
        // Register receiver for EMWaver connection status updates
        bleReceiver = new BLEReceiver(this::updateConnectionUI);
        IntentFilter filter = new IntentFilter(BLEReceiver.ACTION_BLE_CONNECTION_STATUS);
        requireActivity().registerReceiver(bleReceiver, filter);
        
        // Update firmware version display from stored version if connected via BLE
        if (connectionManager != null) {
            BLEService bleService = connectionManager.getBleService();
            if (bleService != null && bleService.checkConnection()) {
                String storedVersion = bleService.getFirmwareVersion();
                if (!"Unknown".equals(storedVersion)) {
                    firmwareVersionText.setText(storedVersion);
                    firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                            android.R.color.holo_blue_dark));
                }
            }
        }
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

    private void updateConnectionStatus() {
        if (connectionManager != null) {
            activeService = connectionManager.getActiveService();
            boolean connected = connectionManager.isConnected();
            DeviceConnectionService.ConnectionType connectionType = connectionManager.getActiveConnectionType();
            
            if (emwaverStatusText != null) {
                if (connected) {
                    String statusText = "Connected (" + connectionType.name() + ")";
                    emwaverStatusText.setText(statusText);
                    emwaverStatusText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_green_dark));
                } else {
                    emwaverStatusText.setText("Not connected");
                    emwaverStatusText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
                }
            }
            if (disconnectButton != null && connectButton != null) {
                disconnectButton.setVisibility(connected ? View.VISIBLE : View.GONE);
                connectButton.setVisibility(connected ? View.GONE : View.VISIBLE);
            }
        } else {
            if (emwaverStatusText != null) {
                emwaverStatusText.setText("Service not initialized");
                emwaverStatusText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
            }
            if (disconnectButton != null) {
                disconnectButton.setVisibility(View.GONE);
            }
            if (connectButton != null) {
                connectButton.setVisibility(View.VISIBLE);
            }
        }
    }





    private void setupSendCommandButton() {
        sendPacketButton.setOnClickListener(v -> {
            String userInput = commandInput.getText().toString().trim();
            if (userInput.isEmpty()) {
                Toast.makeText(getContext(), "Please enter a packet.", Toast.LENGTH_SHORT).show();
                return;
            }

            byte[] commandBytes = parseCommand(userInput);
            if (commandBytes == null) {
                Toast.makeText(getContext(), "Invalid packet format.", Toast.LENGTH_SHORT).show();
                return;
            }

            // Log the sent command bytes
            logTxData(commandBytes);

            Log.d(TAG, "Sending packet: " + bytesToHex(commandBytes));
            if (connectionManager != null) {
                // Always get fresh reference to active service
                activeService = connectionManager.getActiveService();
                if (activeService != null && activeService.checkConnection()) {
                    Log.d(TAG, "Sending via: " + activeService.getConnectionType());
                    activeService.sendPacket(commandBytes);
                } else {
                    Log.w(TAG, "Cannot send: service=" + (activeService != null) + ", connected=" + (activeService != null ? activeService.checkConnection() : false));
                    Toast.makeText(getContext(), "Device not connected", Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(getContext(), "Connection manager not initialized", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void setupDisconnectButton() {
        disconnectButton.setOnClickListener(v -> {
            if (connectionManager != null && connectionManager.isConnected()) {
                connectionManager.disconnect();
                Toast.makeText(getContext(), "Disconnected from device.", Toast.LENGTH_SHORT).show();
                updateConnectionStatus();
            } else {
                Toast.makeText(getContext(), "Not connected or service not available.", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void setupConnectButton() {
        connectButton.setOnClickListener(v -> {
            if (connectionManager != null) {
                emwaverStatusText.setText("Connecting...");
                emwaverStatusText.setTextColor(ContextCompat.getColor(requireContext(), android.R.color.holo_orange_dark));
                connectButton.setVisibility(View.GONE); // Hide connect while attempting, updateConnectionUI will fix later
                
                // Check for USB first, then try BLE
                connectionManager.checkForUsbDevices();
                
                // Also start BLE scan as fallback
                connectionManager.startBleScan();
            } else {
                Toast.makeText(getContext(), "Connection manager not initialized. Cannot connect.", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void setupVersionButton() {
        checkVersionButton.setOnClickListener(v -> {
            if (connectionManager != null && connectionManager.isConnected()) {
                requestFirmwareVersion();
            } else {
                Toast.makeText(getContext(), "Device not connected", Toast.LENGTH_SHORT).show();
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
                
                StringBuilder content = new StringBuilder();
                content.append(String.format("[%s] ", timestamp));
                
                if (showHex.isChecked()) {
                    content.append(hexMessage);
                } else {
                    content.append(asciiMessage);
                }
                
                String htmlOutput = "<font color='#00AA00'>" + content.toString() + "</font>";
                appendToSerialMonitor(htmlOutput);
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

    private void appendToSerialMonitor(String htmlMessage) {
        if (serialMonitor != null && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                serialMonitor.append(Html.fromHtml(htmlMessage + "<br/>"));
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
                if (connectionManager != null) {
                    activeService = connectionManager.getActiveService();
                    if (activeService != null && activeService.checkConnection()) {
                        byte[] data = activeService.getCommand();
                        if (data != null && data.length > 0) {
                            String hexData = bytesToHex(data);
                            String asciiData = bytesToAscii(data);
                            updateResponse(hexData, asciiData);
                        }
                    }
                }
                monitorHandler.postDelayed(this, MONITOR_UPDATE_INTERVAL);
            }
        };
        monitorHandler.post(monitorRunnable);
    }

    // Helper method to update UI based on connection status from broadcast
    private void updateConnectionUI(boolean connected) {
        if (emwaverStatusText != null) {
            emwaverStatusText.setText(connected ? "Connected" : "Not connected");
            emwaverStatusText.setTextColor(connected ? 
                    ContextCompat.getColor(requireContext(), android.R.color.holo_green_dark) : 
                    ContextCompat.getColor(requireContext(), android.R.color.holo_red_dark));
        }
        if (disconnectButton != null && connectButton != null) {
            disconnectButton.setVisibility(connected ? View.VISIBLE : View.GONE);
            connectButton.setVisibility(connected ? View.GONE : View.VISIBLE);
        }
        
        // When connected, request firmware version after a short delay
        // to ensure the connection is fully established
        if (connected) {
            new Handler().postDelayed(() -> {
                requestFirmwareVersion();
            }, 2000); // 500ms delay to allow connection to stabilize
        } else {
            // Reset firmware version to Unknown when disconnected
            if (firmwareVersionText != null) {
                firmwareVersionText.setText("Unknown");
                firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                        android.R.color.darker_gray));
            }
        }
    }



    private void logTxData(byte[] data) {
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                String timestamp = new java.text.SimpleDateFormat("HH:mm:ss.SSS")
                        .format(new java.util.Date());

                StringBuilder content = new StringBuilder();
                content.append(String.format("[%s] ", timestamp));

                if (showHex.isChecked()) {
                    content.append(bytesToHex(data));
                } else {
                    content.append(bytesToAscii(data));
                }

                String htmlOutput = "<font color='#FFD700'>" + content.toString() + "</font>";
                appendToSerialMonitor(htmlOutput);
            });
        }
    }

    // Extract version checking logic into a separate method
    private void requestFirmwareVersion() {
        if (connectionManager != null) {
            activeService = connectionManager.getActiveService();
            if (activeService != null && activeService.checkConnection()) {
                // Create the "version" command (changed from "ver")
                byte[] command = new byte[]{'v', 'e', 'r', 's', 'i', 'o', 'n'};
                
                // Log the command to serial monitor as transmitted
                logTxData(command);
                
                // Send the command to the device using existing command mechanism
                byte[] response = activeService.sendCommand(command, 2000);
                
                // Process the response
                if (response != null && response.length > 0) {
                    // Display the response in the serial monitor
                    String hexData = bytesToHex(response);
                    String asciiData = bytesToAscii(response);
                    updateResponse(hexData, asciiData);
                    
                    // Parse the version from the welcome message
                    String fullMessage = bytesToAscii(response);
                    String version = extractVersion(fullMessage);
                    
                    // Store the version in BLE service if connected via BLE (for persistence)
                    BLEService bleService = connectionManager.getBleService();
                    if (bleService != null && connectionManager.getActiveConnectionType() == DeviceConnectionService.ConnectionType.BLE) {
                        bleService.setFirmwareVersion(version);
                    }
                    
                    // Update the version text field with just the version number
                    firmwareVersionText.setText(version);
                    firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                            android.R.color.holo_blue_dark));
                } else {
                    Toast.makeText(getContext(), "Failed to get firmware version", Toast.LENGTH_SHORT).show();
                    firmwareVersionText.setText("Unknown");
                    firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                            android.R.color.darker_gray));
                }
            } else {
                firmwareVersionText.setText("Unknown");
                firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                        android.R.color.darker_gray));
            }
        } else {
            firmwareVersionText.setText("Unknown");
            firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                    android.R.color.darker_gray));
        }
    }
    
    // Extract version from the welcome message
    private String extractVersion(String message) {
        // Format is now "1.0.0 - Welcome to EMWaver!"
        if (message == null || message.isEmpty()) {
            return "Unknown";
        }
        
        // The version is at the beginning up to the first dash
        int dashIndex = message.indexOf('-');
        if (dashIndex > 0) {
            return message.substring(0, dashIndex).trim();
        }
        
        // If parsing fails (no dash found), just return the original message
        return message;
    }
} 