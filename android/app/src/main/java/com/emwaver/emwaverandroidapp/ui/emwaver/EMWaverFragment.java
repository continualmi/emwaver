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
import android.widget.ImageView;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;
import android.widget.AdapterView;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;

import androidx.annotation.NonNull;
import androidx.fragment.app.Fragment;
import androidx.core.view.MenuHost;
import androidx.core.view.MenuProvider;
import androidx.core.content.ContextCompat;

import com.emwaver.emwaverandroidapp.BLEService;
import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.NativeBuffer;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;
import com.emwaver.emwaverandroidapp.BLEReceiver;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.Deque;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.nio.charset.StandardCharsets;

public class EMWaverFragment extends Fragment {


    private EditText commandInput;
    private Button sendPacketButton;
    private Button clearMonitorButton;
    private TextView emwaverStatusText;
    private Button disconnectButton;
    private Button connectButton;
    private TextView firmwareVersionText;
    private ImageButton checkVersionButton;
    private ImageView deviceIconView;
    
    private DeviceConnectionManager connectionManager;
    private DeviceConnectionService activeService;



    private static final String TAG = "EMWaverFragment";

    private TextView serialMonitor;
    private ScrollView serialMonitorScroll;

    private CheckBox showTxHex;
    private CheckBox showRxHex;

    private static final int MONITOR_UPDATE_INTERVAL = 500; // 500ms
    private Handler monitorHandler;
    private Runnable monitorRunnable;

    private static final int MAX_MONITOR_ENTRIES = 1500;
    private final Deque<CharSequence> monitorLines = new ArrayDeque<>();
    private long rxIndex = 0;
    private long txIndex = 0;
    private final SimpleDateFormat timestampFormat = new SimpleDateFormat("HH:mm:ss.SSS");
    
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
        clearMonitorButton = root.findViewById(R.id.clear_monitor_button);
        serialMonitor = root.findViewById(R.id.serial_monitor);
        serialMonitorScroll = root.findViewById(R.id.serial_monitor_scroll);
        showTxHex = root.findViewById(R.id.show_tx_hex);
        showRxHex = root.findViewById(R.id.show_rx_hex);
        emwaverStatusText = root.findViewById(R.id.emwaver_status_text);
        disconnectButton = root.findViewById(R.id.disconnect_button);
        connectButton = root.findViewById(R.id.connect_button);
        firmwareVersionText = root.findViewById(R.id.firmware_version_text);
        checkVersionButton = root.findViewById(R.id.check_version_button);
        deviceIconView = root.findViewById(R.id.device_icon);


        setupSendCommandButton();
        setupClearMonitorButton();
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
                new Handler(Looper.getMainLooper()).postDelayed(this::requestFirmwareVersion, 500);
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

            String framed = userInput.endsWith("\n") ? userInput : userInput + "\n";
            byte[] commandBytes = framed.getBytes(StandardCharsets.UTF_8);

            Log.d(TAG, "Sending packet: " + bytesToHex(commandBytes));
            if (connectionManager != null) {
                // Always get fresh reference to active service
                activeService = connectionManager.getActiveService();
                if (activeService != null && activeService.checkConnection()) {
                    Log.d(TAG, "Sending via: " + activeService.getConnectionType());
                    activeService.sendPacket(commandBytes);
                    commandInput.setText("");
                } else {
                    Log.w(TAG, "Cannot send: service=" + (activeService != null) + ", connected=" + (activeService != null ? activeService.checkConnection() : false));
                    Toast.makeText(getContext(), "Device not connected", Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(getContext(), "Connection manager not initialized", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void setupClearMonitorButton() {
        if (clearMonitorButton == null) return;
        clearMonitorButton.setOnClickListener(v -> {
            NativeBuffer.clearAll();
            monitorLines.clear();
            rxIndex = 0;
            txIndex = 0;
            if (serialMonitor != null) {
                serialMonitor.setText("");
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

    private static final class PacketEntry {
        final long tsMs;
        final boolean isTx;
        final byte[] data;
        final long seq;

        PacketEntry(long tsMs, boolean isTx, byte[] data, long seq) {
            this.tsMs = tsMs;
            this.isTx = isTx;
            this.data = data;
            this.seq = seq;
        }
    }

    private static final class ReadPackets {
        final byte[] data;
        final long[] tsMs;
        final long nextPacketIndex;
        final long availablePackets;

        ReadPackets(byte[] data, long[] tsMs, long nextPacketIndex, long availablePackets) {
            this.data = data != null ? data : new byte[0];
            this.tsMs = tsMs != null ? tsMs : new long[0];
            this.nextPacketIndex = nextPacketIndex;
            this.availablePackets = availablePackets;
        }
    }

    private ReadPackets parseReadPackets(Object[] resp) {
        if (resp == null || resp.length < 4) {
            return new ReadPackets(new byte[0], new long[0], 0, 0);
        }

        byte[] data = (byte[]) resp[0];
        long[] ts = (long[]) resp[1];
        long next = ((Long) resp[2]).longValue();
        long avail = ((Long) resp[3]).longValue();
        return new ReadPackets(data, ts, next, avail);
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
        NativeBuffer.clearAll();
        monitorLines.clear();
        rxIndex = 0;
        txIndex = 0;
        if (serialMonitor != null) serialMonitor.setText("");
    }

    private void appendMonitorLine(boolean isTx, long tsMs, byte[] bytes) {
        if (serialMonitor == null || getActivity() == null) return;

        final int timestampColor = ContextCompat.getColor(requireContext(), R.color.bufferMonitorTimestamp);
        final int contentColor = ContextCompat.getColor(requireContext(), isTx ? R.color.bufferMonitorTx : R.color.bufferMonitorRx);

        final String timeStr = timestampFormat.format(new Date(tsMs));
        final boolean showHexForPacket = isTx ? (showTxHex != null && showTxHex.isChecked()) : (showRxHex != null && showRxHex.isChecked());
        final String content = showHexForPacket ? bytesToHex(bytes) : bytesToAscii(bytes);

        SpannableStringBuilder line = new SpannableStringBuilder();
        int startTs = line.length();
        line.append("[").append(timeStr).append("] ");
        line.setSpan(new ForegroundColorSpan(timestampColor), startTs, line.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);

        int startContent = line.length();
        line.append(content).append("\n");
        line.setSpan(new ForegroundColorSpan(contentColor), startContent, line.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);

        monitorLines.addLast(line);
        boolean needsRebuild = monitorLines.size() > MAX_MONITOR_ENTRIES;
        while (monitorLines.size() > MAX_MONITOR_ENTRIES) {
            monitorLines.removeFirst();
        }

        getActivity().runOnUiThread(() -> {
            if (needsRebuild) {
                SpannableStringBuilder rebuilt = new SpannableStringBuilder();
                for (CharSequence l : monitorLines) {
                    rebuilt.append(l);
                }
                serialMonitor.setText(rebuilt);
            } else {
                serialMonitor.append(line);
            }
            serialMonitorScroll.post(() -> serialMonitorScroll.fullScroll(View.FOCUS_DOWN));
        });
    }

    private void setupMonitorUpdates() {
        monitorHandler = new Handler(Looper.getMainLooper());
        monitorRunnable = new Runnable() {
            private long seq = 0;

            @Override
            public void run() {
                if (connectionManager != null) {
                    activeService = connectionManager.getActiveService();
                    if (activeService != null && activeService.checkConnection()) {
                        try {
                            List<PacketEntry> batch = new ArrayList<>();

                            ReadPackets tx = parseReadPackets(NativeBuffer.readTxSince(txIndex, 64));
                            int txCount = tx.tsMs.length;
                            if (txCount > 0 && tx.data.length >= txCount * 64) {
                                for (int i = 0; i < txCount; i++) {
                                    int start = i * 64;
                                    int end = start + 64;
                                    batch.add(new PacketEntry(tx.tsMs[i], true, Arrays.copyOfRange(tx.data, start, end), seq++));
                                }
                                txIndex = tx.nextPacketIndex;
                            }

                            ReadPackets rx = parseReadPackets(NativeBuffer.readRxSince(rxIndex, 64));
                            int rxCount = rx.tsMs.length;
                            if (rxCount > 0 && rx.data.length >= rxCount * 64) {
                                for (int i = 0; i < rxCount; i++) {
                                    int start = i * 64;
                                    int end = start + 64;
                                    batch.add(new PacketEntry(rx.tsMs[i], false, Arrays.copyOfRange(rx.data, start, end), seq++));
                                }
                                rxIndex = rx.nextPacketIndex;
                            }

                            if (!batch.isEmpty()) {
                                Collections.sort(batch, (a, b) -> {
                                    if (a.tsMs != b.tsMs) return Long.compare(a.tsMs, b.tsMs);
                                    if (a.isTx != b.isTx) return a.isTx ? -1 : 1;
                                    return Long.compare(a.seq, b.seq);
                                });

                                for (PacketEntry entry : batch) {
                                    appendMonitorLine(entry.isTx, entry.tsMs, entry.data);
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Buffer monitor poll failed", e);
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
            updateDeviceIcon(null);
        }
    }


    // Extract version checking logic into a separate method
    private void requestFirmwareVersion() {
        if (connectionManager != null) {
            activeService = connectionManager.getActiveService();
            if (activeService != null && activeService.checkConnection()) {
                // Create the "version" command (changed from "ver")
                byte[] command = new byte[]{'v', 'e', 'r', 's', 'i', 'o', 'n'};
                
                // Send the command to the device using existing command mechanism
                byte[] response = activeService.sendCommand(command, 2000);
                
                // Process the response
                if (response != null && response.length > 0) {
                    // Parse the version from the welcome message (ASCII bytes)
                    String fullMessage = new String(response, StandardCharsets.US_ASCII);
                    String version = extractVersion(fullMessage);
                    updateDeviceIcon(fullMessage);
                    
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
                    updateDeviceIcon(null);
                }
            } else {
                firmwareVersionText.setText("Unknown");
                firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                        android.R.color.darker_gray));
                updateDeviceIcon(null);
            }
        } else {
            firmwareVersionText.setText("Unknown");
            firmwareVersionText.setTextColor(ContextCompat.getColor(requireContext(), 
                    android.R.color.darker_gray));
            updateDeviceIcon(null);
        }
    }

    private void updateDeviceIcon(String versionResponse) {
        if (deviceIconView == null) return;

        int resId = R.drawable.emwaver_icon;
        if (versionResponse != null) {
            String trimmed = versionResponse.replace("\u0000", "").trim();
            if (trimmed.contains("Welcome to ISM Waver firmware")) {
                resId = R.drawable.ism_icon;
            } else if (trimmed.contains("Welcome to RFID Waver firmware")) {
                resId = R.drawable.rfid_icon;
            } else if (trimmed.contains("Welcome to IR Waver firmware")) {
                resId = R.drawable.infrared_icon;
            } else if (trimmed.contains("Welcome to GPIO Waver firmware")) {
                resId = R.drawable.gpio_icon;
            }
        }

        deviceIconView.setImageResource(resId);
    }
    
    // Extract version from the welcome message
    private String extractVersion(String message) {
        // STM32 firmwares reply to `version` with a welcome string that ends in X.X.X, e.g.
        // "Welcome to ISM Waver firmware 1.0.0"
        if (message == null) {
            return "Unknown";
        }

        String trimmed = message.replace("\u0000", "").trim();
        if (trimmed.isEmpty()) {
            return "Unknown";
        }

        Pattern semverAtEnd = Pattern.compile("(\\d+\\.\\d+\\.\\d+)\\s*$");
        Matcher matcher = semverAtEnd.matcher(trimmed);
        if (matcher.find()) {
            return matcher.group(1);
        }

        return "Unknown";
    }
}
