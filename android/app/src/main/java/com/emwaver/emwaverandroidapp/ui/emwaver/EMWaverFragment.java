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

import com.emwaver.emwaverandroidapp.DeviceConnectionManager;
import com.emwaver.emwaverandroidapp.DeviceConnectionService;
import com.emwaver.emwaverandroidapp.NativeBuffer;
import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.Utils;

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

    private EditText shellInput;
    private ImageButton shellSendButton;
    private TextView shellOutput;
    private ScrollView shellScroll;

    private TextView emwaverStatusText;
    private Button disconnectButton;
    private Button connectButton;
    private TextView firmwareVersionText;
    private ImageButton checkVersionButton;
    private ImageView deviceIconView;
    
    private DeviceConnectionManager connectionManager;
    private DeviceConnectionService activeService;

    private static final String TAG = "EMWaverFragment";
    
    // Handler for periodic status updates
    private Handler statusUpdateHandler;
    private static final int STATUS_UPDATE_INTERVAL = 1000; // 1 second




    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_emwaver, container, false);

        // Initialize UI elements
        shellInput = root.findViewById(R.id.shell_input);
        shellSendButton = root.findViewById(R.id.shell_send_button);
        shellOutput = root.findViewById(R.id.shell_output);
        shellScroll = root.findViewById(R.id.shell_scroll);
        
        emwaverStatusText = root.findViewById(R.id.emwaver_status_text);
        disconnectButton = root.findViewById(R.id.disconnect_button);
        connectButton = root.findViewById(R.id.connect_button);
        firmwareVersionText = root.findViewById(R.id.firmware_version_text);
        checkVersionButton = root.findViewById(R.id.check_version_button);
        deviceIconView = root.findViewById(R.id.device_icon);

        setupShell();
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
                    if (shellOutput != null) {
                        shellOutput.setText("");
                    }
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
        
        // USB-only: request firmware version after connect.
    }

    @Override
    public void onPause() {
        super.onPause();
        
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





    private void setupShell() {
        View.OnClickListener sendListener = v -> {
            String userInput = shellInput.getText().toString().trim();
            if (userInput.isEmpty()) return;

            // Echo command
            appendShellOutput("emw> " + userInput + "\n");
            shellInput.setText("");

            String framed = userInput.endsWith("\n") ? userInput : userInput + "\n";
            byte[] commandBytes = framed.getBytes(StandardCharsets.UTF_8);

            if (connectionManager != null) {
                activeService = connectionManager.getActiveService();
                if (activeService != null && activeService.checkConnection()) {
                    new Thread(() -> {
                        byte[] response = activeService.sendCommand(commandBytes, 2000);
                        if (getActivity() != null) {
                            getActivity().runOnUiThread(() -> {
                                if (response != null) {
                                    String respStr = new String(response, StandardCharsets.US_ASCII).replace("\0", "").trim();
                                    appendShellOutput(respStr + "\n");
                                } else {
                                    appendShellOutput("[No response]\n");
                                }
                            });
                        }
                    }).start();
                } else {
                    Toast.makeText(getContext(), "Device not connected", Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(getContext(), "Connection manager not initialized", Toast.LENGTH_SHORT).show();
            }
        };

        shellSendButton.setOnClickListener(sendListener);
        shellInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                sendListener.onClick(v);
                return true;
            }
            return false;
        });
    }

    private void appendShellOutput(String text) {
        if (shellOutput != null) {
            shellOutput.append(text);
            shellScroll.post(() -> shellScroll.fullScroll(View.FOCUS_DOWN));
        }
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
                
                // USB MIDI only
                connectionManager.checkForUsbDevices();
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
